/**
 * 上传功能独立模块
 * 包含：富文本编辑器图片上传、FAQ附件上传
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const auth = require('./auth');
const { auditLog } = require('./logger');

const FAQ_PATH = path.join(__dirname, '../data/faq.json');
const FAQ_ATTACHMENTS_DIR = path.join(__dirname, 'uploads/faq_attachments');
const EDITOR_IMAGE_DIR = path.join(__dirname, 'uploads/images');

if (!fs.existsSync(FAQ_ATTACHMENTS_DIR)) fs.mkdirSync(FAQ_ATTACHMENTS_DIR, { recursive: true });
if (!fs.existsSync(EDITOR_IMAGE_DIR)) fs.mkdirSync(EDITOR_IMAGE_DIR, { recursive: true });

// ============ FAQ 附件上传配置 ============
const faqAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FAQ_ATTACHMENTS_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const uploadFaqAttachment = multer({
  storage: faqAttachmentStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx|txt|md$/i;
    allowed.test(path.extname(file.originalname)) ? cb(null, true) : cb(new Error('不支持的文件格式'));
  }
});

// multer 错误统一转为 JSON（避免 Express 默认返回 HTML 错误页）
function uploadArrayWithErrorHandler(mw, maxCount) {
  return (req, res, next) => {
    mw.array('files', maxCount)(req, res, (err) => {
      if (err) {
        console.error('[UPLOAD] attachment multer error:', err.message, err.code);
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ success: false, error: '文件过大，单文件上限 10MB' });
        }
        return res.status(400).json({ success: false, error: err.message });
      }
      next();
    });
  };
}

// ============ 富文本编辑器图片上传配置 ============
const editorImageStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, EDITOR_IMAGE_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `img_${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const uploadEditorImage = multer({
  storage: editorImageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp$/i;
    allowed.test(path.extname(file.originalname)) ? cb(null, true) : cb(new Error('只支持图片格式'));
  }
});

// ============ 工具函数 ============
function getFAQ() {
  if (!fs.existsSync(FAQ_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8')); } catch (e) { return []; }
}
function saveFAQ(data) { fs.writeFileSync(FAQ_PATH, JSON.stringify(data, null, 2)); }

// ============ 认证中间件 ============
// 所有上传管理路由都需要认证 + 管理员权限（修复未授权访问漏洞）
router.use(auth.authMiddleware);
router.use(auth.adminOnly);

// ============ 上传 API ============

/**
 * 图片上传接口（供富文本编辑器使用）
 * POST /api/admin/upload/editor-image
 * 返回格式：{ errno: 0, data: { url } }
 */
router.post('/upload/editor-image', uploadEditorImage.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ errno: 1, message: '未收到文件' });
    const fileUrl = `/uploads/images/${req.file.filename}`;
    auditLog('editor_image_upload', req.user ? req.user.username : 'unknown', { originalName: req.file.originalname });
    res.json({ errno: 0, data: { url: fileUrl } });
  } catch (err) {
    res.status(500).json({ errno: 1, message: err.message });
  }
});

/**
 * FAQ 附件上传接口
 * POST /api/admin/faq/:id/attachments
 * 支持多文件上传（最多5个）
 */
router.post('/faq/:id/attachments', uploadArrayWithErrorHandler(uploadFaqAttachment, 5), (req, res) => {
  try {
    const faqId = req.params.id;
    const faqList = getFAQ();
    const idx = faqList.findIndex(f => f.id === faqId);
    if (idx === -1) return res.status(404).json({ success: false, error: 'FAQ 不存在' });
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: '未收到文件' });
    }
    
    const attachments = faqList[idx].attachments || [];
    for (const file of req.files) {
      attachments.push({
        id: uuidv4(),
        filename: file.filename,
        originalName: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        size: file.size,
        mimeType: file.mimetype,
        uploadedAt: new Date().toISOString()
      });
    }
    
    faqList[idx].attachments = attachments;
    saveFAQ(faqList);
    auditLog('faq_attachment_upload', req.user ? req.user.username : 'unknown', { faqId: req.params.id, count: req.files.length });
    res.json({ success: true, attachments });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 删除 FAQ 附件
 * DELETE /api/admin/faq/:id/attachments/:fileId
 */
router.delete('/faq/:id/attachments/:fileId', (req, res) => {
  try {
    const { id, fileId } = req.params;
    const faqList = getFAQ();
    const idx = faqList.findIndex(f => f.id === id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'FAQ 不存在' });
    
    const attachments = faqList[idx].attachments || [];
    const fileIdx = attachments.findIndex(a => a.id === fileId);
    if (fileIdx === -1) return res.status(404).json({ success: false, error: '附件不存在' });
    
    // 删除物理文件
    const filePath = path.join(FAQ_ATTACHMENTS_DIR, attachments[fileIdx].filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    
    // 删除数据库记录
    attachments.splice(fileIdx, 1);
    faqList[idx].attachments = attachments;
    saveFAQ(faqList);
    auditLog('faq_attachment_delete', req.user ? req.user.username : 'unknown', { faqId: id, fileId });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
