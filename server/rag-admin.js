/**
 * RAG 管理统一路由模块
 * 整合：知识库管理、分类管理、FAQ管理、意图理解、答案改写、向量管理、上传管理
 * 保持所有 API 路径不变，前端无需修改
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

// 用户认证模块
const auth = require('./auth');

// ============ 密码处理（与 auth.js 保持一致）============
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return salt + ':' + hash;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verifyHash, 'hex'));
  } catch (e) {
    return false;
  }
}

// ============ 数据共享模块 ============
const data = require('./data');

// 从 data.js 导入所有数据访问函数
const {
  loadCategories, saveCategories,
  getFAQ, saveFAQ,
  loadOrg, saveOrg,
  loadPersonnel, savePersonnel,
  loadPermissions, savePermissions,
  loadA8Config, saveA8Config,
  loadSoftwareInfo, saveSoftwareInfo,
  loadSystemConfig, saveSystemConfig,
  loadSynonyms, saveSynonyms,
  loadStopwords, saveStopwords,
  loadAnnouncement, saveAnnouncement,
  loadSSOWhitelist, saveSSOWhitelist,
  CATEGORIES_PATH, FAQ_PATH, ORG_PATH, PERSONNEL_PATH, PERMISSIONS_PATH, A8_CONFIG_PATH, KNOWLEDGE_BASES_PATH,
  SYSTEM_CONFIG_PATH, SYNONYMS_PATH, STOPWORDS_PATH, ANNOUNCEMENT_PATH, SSO_WHITELIST_PATH
} = data;

// ============ 日志系统 ============
const { auditLog, errorLog, getLogFiles, readLogFile, cleanOldLogs } = require('./logger');

// ============ 依赖模块 ============
const {
  addDocumentChunks, semanticSearch, rebuildVectorStore, getStats: getVectorStats,
  buildFAQEmbeddingCache, searchByFAQCacheAsync, deleteDocument,
  getBM25Stats
} = require('./vector-store');

const { callOllamaChat, callOllamaGenerate, callOllamaJSON } = require('./ollama-client');

const {
  understandIntent, batchUnderstandIntents, fallbackIntent, INTENT_TAXONOMY
} = require('./intent-understanding');

// 意图在线标注 / 纠错反馈闭环
const intentFeedback = require('./intent-feedback');

const {
  storeConversationRound, getConversationHistory, enhanceQueryWithMemory,
  getMemoryStats, clearConversationHistory
} = require('./dialogue-memory');

// ============ 基础信息数据操作 ============


const {
  rewriteToColloquial, batchRewrite, evaluateQuality, getToneList
} = require('./answer-rewriter');

// ============ 配置 ============
const OLLAMA_BASE_URL = 'http://172.17.6.18:11434';
const UPLOAD_DIR = path.join(__dirname, '../data/uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// FAQ 附件上传目录
const FAQ_ATTACHMENTS_DIR = path.join(__dirname, 'uploads/faq_attachments');
if (!fs.existsSync(FAQ_ATTACHMENTS_DIR)) fs.mkdirSync(FAQ_ATTACHMENTS_DIR, { recursive: true });

// ============ 工具函数 ============
/**
 * 智能判定对话是否已解决（基于对话内容自动判定）
 * 判定条件（满足任一即视为"已解决"）：
 * 1. 对话至少有 2 条消息（用户提问 + AI回答）
 * 2. 最后一条消息是 AI 发送的（说明AI给出了回答）
 * 3. 对话持续时长 ≥ 30秒（避免误触）
 */
function isResolved(conversation) {
  try {
    const messages = JSON.parse(conversation.messages || '[]');
    
    // 条件1：至少有 2 条消息
    if (messages.length < 2) return false;
    
    // 条件2：最后一条消息是 AI 发送的
    const lastMessage = messages[messages.length - 1];
    if (lastMessage.role !== 'assistant' && lastMessage.role !== 'ai') return false;
    
    // 条件3：对话持续时长 ≥ 30秒
    const createdAt = new Date(conversation.created_at).getTime();
    const updatedAt = new Date(conversation.updated_at).getTime();
    const duration = (updatedAt - createdAt) / 1000; // 转换为秒
    if (duration < 30) return false;
    
    return true;
  } catch (e) {
    return false;
  }
}


function loadKnowledgeBases() {
  if (!fs.existsSync(KNOWLEDGE_BASES_PATH)) {
    const defaultKB = [{ id: 'kb_default', name: data.loadSoftwareInfo().knowledgeBaseName, description: '默认知识库', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isDefault: true, isActive: true }];
    saveKnowledgeBases(defaultKB);
    return defaultKB;
  }
  try { return JSON.parse(fs.readFileSync(KNOWLEDGE_BASES_PATH, 'utf8')); } catch (e) { return []; }
}
function saveKnowledgeBases(data) { fs.writeFileSync(KNOWLEDGE_BASES_PATH, JSON.stringify(data, null, 2)); }

// ============ 上传配置 ============
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'upload_' + Date.now() + '_' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.md', '.pdf', '.doc', '.docx', '.xls', '.xlsx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`不支持的文件格式：${ext || file.originalname}，仅支持 .txt/.md/.pdf/.doc/.docx/.xls/.xlsx`));
  }
});

// multer 错误统一转为 JSON（避免 Express 默认返回 HTML 错误页导致前端 catch 到固定文案）
function uploadSingleWithErrorHandler(uploader, fieldName) {
  return (req, res, next) => {
    uploader.single(fieldName)(req, res, (err) => {
      if (err) {
        console.error('[UPLOAD] multer error:', err.message, err.code);
        if (err.code === 'LIMIT_FILE_SIZE') {
          const limitMB = Math.round((err.limits?.fileSize || 10 * 1024 * 1024) / 1024 / 1024);
          return res.status(400).json({ success: false, error: `文件过大，单文件上限 ${limitMB}MB` });
        }
        return res.status(400).json({ success: false, error: err.message });
      }
      next();
    });
  };
}

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'media_' + Date.now() + '_' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const uploadMedia = multer({
  storage: mediaStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext) || file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('仅支持图片格式（jpg/png/gif/webp/bmp）'));
  }
});

// ============ 认证中间件 ============
// 所有管理后台路由都需要认证 + 管理员权限
router.use(auth.authMiddleware);
router.use(auth.adminOnly);

// ==========================================
// 一、统计 API
// ==========================================
router.get('/stats', async (req, res) => {
  try {
    const faqList = getFAQ();
    const categoryList = loadCategories();
    const knowledgeBaseList = loadKnowledgeBases().filter(k => k.isActive);
    const conversationList = loadConversations();

    // 1. 基础统计
    const totalFAQ = faqList.length;
    const totalCategories = categoryList.length;
    const totalKnowledgeBases = knowledgeBaseList.length;
    const totalConversations = conversationList.length;
    const resolvedConversations = conversationList.filter(c => isResolved(c)).length;
    const resolutionRate = totalConversations > 0 ? Math.round(resolvedConversations / totalConversations * 100) : 0;

    // 2. 对话趋势数据（按日统计，最近30天）
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dailyTrend = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const dayConversations = conversationList.filter(c => {
        const createdDate = new Date(c.created_at).toISOString().split('T')[0];
        return createdDate === dateStr;
      });
      dailyTrend.push({
        date: dateStr,
        count: dayConversations.length,
        resolved: dayConversations.filter(c => isResolved(c)).length
      });
    }

    // 3. 按周统计（最近12周）
    const weeklyTrend = [];
    for (let i = 11; i >= 0; i--) {
      const weekStart = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      const weekConversations = conversationList.filter(c => {
        const created = new Date(c.created_at);
        return created >= weekStart && created < weekEnd;
      });
      weeklyTrend.push({
        week: `第${12 - i}周`,
        startDate: weekStart.toISOString().split('T')[0],
        endDate: weekEnd.toISOString().split('T')[0],
        count: weekConversations.length,
        resolved: weekConversations.filter(c => isResolved(c)).length
      });
    }

    // 4. 按月统计（最近6个月）
    const monthlyTrend = [];
    for (let i = 5; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthStr = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
      const monthConversations = conversationList.filter(c => {
        const createdMonth = new Date(c.created_at).toISOString().slice(0, 7);
        return createdMonth === monthStr;
      });
      monthlyTrend.push({
        month: monthStr,
        count: monthConversations.length,
        resolved: monthConversations.filter(c => isResolved(c)).length
      });
    }

    // 5. 分类统计
    const categoryStats = categoryList.map(cat => {
      const catFAQs = faqList.filter(f => f.category === cat.name);
      const catConversations = conversationList.filter(c => c.intent === cat.name);
      return {
        id: cat.id,
        name: cat.name,
        faqCount: catFAQs.length,
        conversationCount: catConversations.length
      };
    }).sort((a, b) => b.conversationCount - a.conversationCount);

    // 6. 知识库统计
    const knowledgeBaseStats = knowledgeBaseList.map(kb => {
      const kbFAQs = faqList.filter(f => f.knowledgeBaseId === kb.id);
      return {
        id: kb.id,
        name: kb.name,
        faqCount: kbFAQs.length
      };
    });

    // 7. 最近对话列表（最近20条）
    const recentConversations = conversationList
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .slice(0, 20)
      .map(c => ({
        session_id: c.session_id,
        intent: c.intent,
        resolved: isResolved(c),
        created_at: c.created_at,
        updated_at: c.updated_at,
        messageCount: JSON.parse(c.messages || '[]').length
      }));

    res.json({
      // 概览指标
      overview: {
        totalFAQ,
        totalCategories,
        totalKnowledgeBases,
        totalConversations,
        resolvedConversations,
        resolutionRate,
        vectorStats: await getVectorStats()
      },
      // 趋势数据
      trends: {
        daily: dailyTrend,
        weekly: weeklyTrend,
        monthly: monthlyTrend
      },
      // 分类统计
      categoryStats,
      // 知识库统计
      knowledgeBaseStats,
      // 最近对话
      recentConversations
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 辅助函数：加载对话数据 ============
function loadConversations() {
  const CONVERSATIONS_PATH = path.join(__dirname, '../data/conversations.json');
  if (!fs.existsSync(CONVERSATIONS_PATH)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(CONVERSATIONS_PATH, 'utf8'));
    return data.conversations || [];
  } catch (e) {
    return [];
  }
}


// ==========================================
// 二、知识库管理 API
// ==========================================
router.get('/knowledge-bases', (req, res) => {
  try {
    res.json(loadKnowledgeBases().filter(k => k.isActive));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/knowledge-bases', (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '知识库名称必填' });
    const list = loadKnowledgeBases();
    if (list.some(k => k.name === name.trim())) return res.status(400).json({ error: '知识库名称已存在' });
    const id = 'kb_' + Date.now();
    list.push({ id, name: name.trim(), description: description || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isDefault: false, isActive: true });
    saveKnowledgeBases(list);
    auditLog('kb_create', req.user ? req.user.username : 'unknown', { id, name: name.trim() });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/knowledge-bases/:id', (req, res) => {
  try {
    const list = loadKnowledgeBases();
    const idx = list.findIndex(k => k.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const { name, description } = req.body;
    if (name !== undefined) list[idx].name = name.trim();
    if (description !== undefined) list[idx].description = description;
    list[idx].updatedAt = new Date().toISOString();
    saveKnowledgeBases(list);
    auditLog('kb_update', req.user ? req.user.username : 'unknown', { id: req.params.id, name: (name || '').trim() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/knowledge-bases/:id', (req, res) => {
  try {
    const list = loadKnowledgeBases();
    const target = list.find(k => k.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.isDefault) return res.status(400).json({ error: '默认知识库不可删除' });
    const catList = loadCategories();
    catList.forEach(c => { if (c.knowledgeBaseId === target.id) c.knowledgeBaseId = 'kb_default'; });
    saveCategories(catList);
    const faqList = getFAQ();
    const catNames = catList.filter(c => c.knowledgeBaseId === target.id).map(c => c.name);
    faqList.forEach(f => { if (catNames.includes(f.category)) f.category = '常见问题'; });
    saveFAQ(faqList);
    list.find(k => k.id === req.params.id).isActive = false;
    saveKnowledgeBases(list);
    auditLog('kb_delete', req.user ? req.user.username : 'unknown', { id: req.params.id, name: target.name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 三、分类管理 API（支持二级分类）
// ==========================================
router.get('/categories', (req, res) => {
  try {
    const { knowledgeBaseId } = req.query;
    let list = loadCategories();
    if (knowledgeBaseId) list = list.filter(c => c.knowledgeBaseId === knowledgeBaseId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/categories', (req, res) => {
  try {
    const { name, description, parentId, knowledgeBaseId } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '分类名称必填' });
    const list = loadCategories();
    if (list.some(c => c.name === name.trim())) return res.status(400).json({ error: '分类名称已存在' });
    const id = 'cat_' + Date.now();
    list.push({ id, name: name.trim(), description: description || '', parentId: parentId || null, knowledgeBaseId: knowledgeBaseId || '', sortOrder: list.length, isDefault: false });
    saveCategories(list);
    auditLog('category_create', req.user ? req.user.username : 'unknown', { id, name: name.trim(), parentId: parentId || null });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/categories/:id', (req, res) => {
  try {
    const list = loadCategories();
    const idx = list.findIndex(c => c.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const { name, description, sortOrder, parentId, knowledgeBaseId } = req.body;
    if (name !== undefined) list[idx].name = name.trim();
    if (description !== undefined) list[idx].description = description;
    if (sortOrder !== undefined) list[idx].sortOrder = Number(sortOrder);
    if (parentId !== undefined) list[idx].parentId = parentId || null;
    if (knowledgeBaseId !== undefined) list[idx].knowledgeBaseId = knowledgeBaseId;
    saveCategories(list);
    auditLog('category_update', req.user ? req.user.username : 'unknown', { id: req.params.id, name: (name || '').trim() });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/categories/:id', (req, res) => {
  try {
    const list = loadCategories();
    const target = list.find(c => c.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.isDefault) return res.status(400).json({ error: '默认分类不可删除' });
    const faqList = getFAQ();
    for (const f of faqList) {
      if (f.category === target.name) f.category = '常见问题';
    }
    saveFAQ(faqList);
    saveCategories(list.filter(c => c.id !== req.params.id));
    auditLog('category_delete', req.user ? req.user.username : 'unknown', { id: req.params.id, name: target.name });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 四、FAQ 管理 API（RAG核心）
// ==========================================
router.get('/faq', (req, res) => {
  try {
    const { search, category, page = 1, pageSize = 10 } = req.query;
    let list = getFAQ();
    if (search) {
      const kw = search.toLowerCase();
      list = list.filter(f => f.question.toLowerCase().includes(kw) || f.answer.toLowerCase().includes(kw));
    }
    if (category) list = list.filter(f => f.category === category);
    const total = list.length;
    const p = Number(page), ps = Number(pageSize);
    const paged = list.slice((p - 1) * ps, p * ps);
    res.json({ success: true, data: paged, total, page: p, pageSize: ps });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/faq', async (req, res) => {
  try {
    const { question, keywords, answer, intent, category } = req.body;
    if (!question || !answer) return res.status(400).json({ error: 'question 和 answer 必填' });
    const list = getFAQ();
    const id = 'faq_' + Date.now();
    const item = {
      id, question,
      keywords: Array.isArray(keywords) ? keywords : (keywords || '').split(/[,，;；\s]+/).filter(Boolean),
      answer, intent: intent || 'custom', category: category || '其他'
    };
    list.push(item);
    saveFAQ(list);
    addDocumentChunks(id, question, `问题：${question}\n答案：${answer}`, { category: item.category, source: 'faq' })
      .then(() => console.log('[RAG] 新增FAQ向量化完成:', question.slice(0, 30)))
      .catch(e => console.error('[RAG] 新增FAQ向量化失败:', e.message));
    auditLog('faq_create', req.user ? req.user.username : 'unknown', { id, question: (question || '').slice(0, 60), category: item.category });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/faq/:id', async (req, res) => {
  try {
    const list = getFAQ();
    const idx = list.findIndex(f => f.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const { question, keywords, answer, intent, category } = req.body;
    if (question !== undefined) list[idx].question = question;
    if (keywords !== undefined) list[idx].keywords = Array.isArray(keywords) ? keywords : (keywords || '').split(/[,，;；\s]+/).filter(Boolean);
    if (answer !== undefined) list[idx].answer = answer;
    if (intent !== undefined) list[idx].intent = intent;
    if (category !== undefined) list[idx].category = category;
    saveFAQ(list);
    const f = list[idx];
    addDocumentChunks(f.id, f.question, `问题：${f.question}\n答案：${f.answer}`, { category: f.category, source: 'faq' })
      .then(() => console.log('[RAG] FAQ更新向量化完成:', f.question.slice(0, 30)))
      .catch(e => console.error('[RAG] FAQ更新向量化失败:', e.message));
    auditLog('faq_update', req.user ? req.user.username : 'unknown', { id: req.params.id, question: (question || '').slice(0, 60), category });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/faq/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids 必须是非空数组' });
    const list = getFAQ();
    const before = list.length;
    const newList = list.filter(f => !ids.includes(f.id));
    if (newList.length === before) return res.status(404).json({ error: '未找到要删除的条目' });
    saveFAQ(newList);
    ids.forEach(id => deleteDocument(id));
    auditLog('faq_batch_delete', req.user ? req.user.username : 'unknown', { count: before - newList.length, ids });
    res.json({ success: true, deleted: before - newList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/faq/:id', (req, res) => {
  try {
    const list = getFAQ();
    const newList = list.filter(f => f.id !== req.params.id);
    if (newList.length === list.length) return res.status(404).json({ error: 'Not found' });
    saveFAQ(newList);
    deleteDocument(req.params.id);
    auditLog('faq_delete', req.user ? req.user.username : 'unknown', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// 读取文本文件并按编码解码：优先 UTF-8（严格），失败回退 GBK/GB18030（兼容 Windows ANSI 中文文档），最后兜底 utf8
function readTextWithEncoding(filePath) {
  const buf = fs.readFileSync(filePath);
  try {
    // 严格 UTF-8：含非法序列则抛错，转入 GBK 分支
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    try {
      return new TextDecoder('gbk').decode(buf);
    } catch (e2) {
      return buf.toString('utf8');
    }
  }
}

// 无显式 Q/A 标记时，按文档结构智能拆分为多条 FAQ：
//  - 编号条目：1. / 2、 / 一、 / 二) 等（编号后的文本作为「问题」，后续内容作为「答案」）
//  - 标题层级：# / ## / 【标题】 等（标题作为「问题」，后续内容作为「答案」）
//  - 普通段落：以问号结尾的行拆为 问题/答案；无问号则首句作问题、整段作答案
//  - 空行：普通段落模式作为分隔（每条段落一条）；编号/标题条目内保留为答案换行
// 将文档按结构智能拆分为多条 FAQ，统一识别以下「块起始」信号：
//  - 显式 Q/A 标记：问：/答：/问题：/答案：/Q:/A:（答：行给当前块设答案，不开启新块）
//  - 编号条目：1. / 2、 / 一、 / 二) 等（编号后文本作「问题」，后续作「答案」）
//  - 标题层级：# / ## / 【标题】 / - 要点 等（标题作「问题」，后续作「答案」）
//  - 含问号的普通行：问号前作「问题」，问号后作「答案」，并开启新块
//  - 其余普通行：续接到当前块「答案」
//  - 空行：普通段落模式作为分隔；编号/标题块内保留为答案换行
// [FAQ 解析函数已迁移至 ./lib/faq-parser.js（faq-doc-parser 模块，领域自适应 + 细分行业 preset + 自动识别），
//  本文件仅保留生产封装 parseDocToFAQWithLLM，见下方 §FAQ 解析封装。]

// ============================================================
// FAQ 文档解析（混合架构，兼顾「不漏条」与「语义质量」）
//   1) parseDocToFAQ（正则，确定性）：先保证逐条完整抽取、问答不混同 —— 提取源
//   2) LLM 批量润色：把每条 question 改写成自然语言问句 + 生成关键词 —— 语义增强
//   3) LLM 不可用时自动跳过润色，直接返回正则结果（绝不丢条、绝不崩）
// 设计取舍：纯 LLM 抽取在短文档上召回不稳定（实测同文档 9 条/1 条波动），
//          故以正则为「完整性」基石，LLM 只做可靠的「质量」增强。
// ============================================================

// ============================================================
// FAQ 解析：复用 faq-doc-parser 模块（领域自适应 + 细分行业 preset + 自动识别）
// 模块文件：server/lib/faq-parser.js（与 D:/Clow/skills/faq-doc-parser 同步维护）
// 该模块已覆盖 财务/HR/IT/法务/通用 + 制造业全板块 关键词，并内置 gmp/iatf16949/
// haccp/iso13485/as9100 细分行业 preset，支持 preset:'auto' 自动识别。
// ============================================================
const { parseDocToFAQWithLLM: _parseDocToFAQWithLLM } = require('./lib/faq-parser');

// 生产封装：注入本地 LLM 客户端（callOllamaJSON）；
// preset 默认 'auto'（按签名词自动识别细分行业），调用方可传 { preset: 'gmp' } 等指定行业。
async function parseDocToFAQWithLLM(text, category, opts) {
  return _parseDocToFAQWithLLM(text, category, callOllamaJSON, Object.assign({ preset: 'auto' }, opts || {}));
}

// FAQ 文件上传 + 自动提取
router.post('/faq/upload', uploadSingleWithErrorHandler(upload, 'file'), async (req, res) => {
  console.log('[UPLOAD] body=', JSON.stringify(req.body), 'query.category=', req.query.category);
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase();
    let text = '';

    try {
      if (ext === '.txt' || ext === '.md') {
        text = readTextWithEncoding(filePath);
      } else if (ext === '.pdf') {
        try {
          const pdfParse = require('pdf-parse');
          const dataBuffer = fs.readFileSync(filePath);
          const pdfData = await pdfParse(dataBuffer);
          text = pdfData.text;
        } catch (e) {
          text = readTextWithEncoding(filePath);
        }
      } else if (ext === '.docx' || ext === '.doc') {
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: filePath });
          text = result.value;
        } catch (e) {
          text = readTextWithEncoding(filePath);
        }
      } else if (ext === '.xlsx' || ext === '.xls') {
        try {
          const XLSX = require('xlsx');
          const workbook = XLSX.readFile(filePath);
          const sheets = [];
          for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            sheets.push(`### ${name}\n` + csv.replace(/,/g, '，').replace(/\n/g, '\n'));
          }
          text = sheets.join('\n\n');
        } catch (e) {
          text = readTextWithEncoding(filePath);
        }
      } else {
        fs.unlinkSync(filePath);
        return res.status(400).json({ error: '不支持的文件格式' });
      }
    } catch (e) {
      text = fs.readFileSync(filePath, 'utf8');
    }

    // 简单提取 FAQ：按行分割，尝试识别 Q/A 对
    const uploadCategory = (req.body.category && req.body.category.trim()) ? req.body.category.trim()
                          : (req.query.category && req.query.category.trim()) ? req.query.category.trim()
                          : null;
    console.log('[UPLOAD] 最终分类 =', uploadCategory);

    // LLM 语义解析（主方案）：复用 faq-doc-parser 模块，preset 默认 auto 自动识别细分行业；
    // 调用方可传 req.body.preset（如 'gmp' / ['iatf16949','haccp']）指定行业以精提关键词。
    const presetOpt = req.body.preset ? { preset: req.body.preset } : undefined;
    const extracted = (await parseDocToFAQWithLLM(text.trim(), uploadCategory || '其他', presetOpt)).map(b => ({
      question: b.question, answer: b.answer, category: uploadCategory || '其他', keywords: b.keywords || []
    }));

    // 极端情况兜底：文本非空但未能切分，仍保留一条
    if (extracted.length === 0 && text.trim()) {
      extracted.push({ question: originalName, answer: text.trim().slice(0, 2000), category: uploadCategory || '其他', keywords: [] });
    }
    const list = getFAQ();
    let added = 0;
    for (const item of extracted) {
      const id = 'faq_' + Date.now() + '_' + added;
      list.push({ id, ...item, intent: item.intent || 'custom' });
      const content = `问题：${item.question}\n答案：${item.answer}`;
      addDocumentChunks(id, item.question, content, { category: item.category, source: 'faq_upload' })
        .then(() => console.log('[RAG] 上传文档FAQ向量化完成:', item.question.slice(0, 30)))
        .catch(e => console.error('[RAG] 上传文档FAQ向量化失败:', e.message));
      added++;
    }
    saveFAQ(list);
    try { fs.unlinkSync(filePath); } catch (e) {}
    auditLog('faq_upload', req.user ? req.user.username : 'unknown', { filename: originalName, added, category: uploadCategory || '其他' });
    res.json({ success: true, added, total: list.length });
  } catch (err) {
    console.error('文件上传处理失败：', err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 五、智能意图理解 API（RAG流程核心环节）
// ==========================================
// 单条问题意图解析
router.post('/intent-parse', async (req, res) => {
  try {
    const { query, context = {} } = req.body;
    if (!query || !query.trim()) return res.status(400).json({ error: 'query 不能为空' });
    console.log('[Intent API] 收到请求:', JSON.stringify(query));
    const result = await understandIntent(query.trim(), context);
    console.log('[Intent API] understandIntent 结果:', JSON.stringify(result));
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Intent API] 解析失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 批量问题意图解析
router.post('/intent-batch', async (req, res) => {
  try {
    const { queries } = req.body;
    if (!Array.isArray(queries) || queries.length === 0) return res.status(400).json({ error: 'queries 必须是非空数组' });
    const results = await batchUnderstandIntents(queries);
    res.json({ success: true, results, total: results.length });
  } catch (err) {
    console.error('[Intent API] 批量解析失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取意图分类体系
router.get('/intent-taxonomy', (req, res) => {
  try {
    res.json({ success: true, taxonomy: INTENT_TAXONOMY });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 五-二、意图在线标注 / 纠错反馈闭环 API
// ==========================================
// 在线意图识别记录（来自对话 faq_logs，供管理员纠错）
router.get('/intent-recognitions', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';
    const data = intentFeedback.getRecognitions({ limit, offset, search });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 纠错记录列表
router.get('/intent-corrections', (req, res) => {
  try {
    const source = req.query.source || undefined;
    const applied = req.query.applied === undefined ? undefined : (req.query.applied === 'true');
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const search = req.query.search || '';
    const data = intentFeedback.listCorrections({ source, applied, limit, offset, search });
    res.json({ success: true, ...data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增纠错（后台管理员主动纠错）
router.post('/intent-correct', (req, res) => {
  try {
    const { userMessage, originalIntent, correctedIntent, note, makeRule, sessionId, messageId } = req.body;
    const record = intentFeedback.addCorrection({
      source: 'admin',
      sessionId: sessionId || null,
      messageId: messageId || null,
      userMessage,
      originalIntent: originalIntent || null,
      correctedIntent,
      correctedBy: req.user ? req.user.username : 'admin',
      note: note || '',
      makeRule: !!makeRule
    });
    auditLog('intent_correct', req.user ? req.user.username : 'unknown', {
      source: 'admin',
      userMessage: (userMessage || '').slice(0, 60),
      corrected: correctedIntent
    });
    res.json({ success: true, correction: record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 删除纠错记录
router.delete('/intent-corrections/:id', (req, res) => {
  try {
    const ok = intentFeedback.deleteCorrection(req.params.id);
    if (!ok) return res.status(404).json({ error: '记录不存在' });
    auditLog('intent_correct_delete', req.user ? req.user.username : 'unknown', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 反馈沉淀：把纠错转为 few-shot 样例 + 高频规则，反哺分类器
router.post('/intent-feedback/apply', (req, res) => {
  try {
    const stats = intentFeedback.applyFeedback();
    auditLog('intent_feedback_apply', req.user ? req.user.username : 'unknown', stats);
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 反馈统计
router.get('/intent-feedback/stats', (req, res) => {
  try {
    res.json({ success: true, stats: intentFeedback.getCorrectionStats() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 六、LLM 智能改写答案 API（RAG流程核心环节）
// ==========================================
// 改写单个答案（答案改写tab使用）
router.post('/rewrite-answer', async (req, res) => {
  try {
    const { answer, tone = '亲切友好' } = req.body;
    if (!answer || !answer.trim()) return res.status(400).json({ error: 'answer 不能为空' });
    const rewritten = await rewriteToColloquial(answer, {
      tone: tone || 'friendly',
      userMessage: '',
      conversationHistory: [],
      userName: '',
      isReturnUser: false,
      intent: null
    });
    res.json({ success: true, original: answer, rewritten, changed: rewritten !== answer });
  } catch (err) {
    console.error('[Rewrite API] 改写失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 测试改写单个答案（兼容旧路径）
router.post('/rewrite-test', async (req, res) => {
  try {
    const { originalAnswer, userMessage, conversationHistory, options = {} } = req.body;
    if (!originalAnswer || !originalAnswer.trim()) return res.status(400).json({ error: 'originalAnswer 不能为空' });
    const rewritten = await rewriteToColloquial(originalAnswer, {
      userMessage: userMessage || '',
      conversationHistory: conversationHistory || [],
      tone: options.tone || 'friendly',
      userName: options.userName || '',
      isReturnUser: options.isReturnUser || false,
      intent: options.intent || null
    });
    res.json({ success: true, original: originalAnswer, rewritten, changed: rewritten !== originalAnswer });
  } catch (err) {
    console.error('[Rewrite API] 改写失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 批量改写答案
router.post('/rewrite-batch', async (req, res) => {
  try {
    const { answers, options = {} } = req.body;
    if (!Array.isArray(answers) || answers.length === 0) return res.status(400).json({ error: 'answers 必须是非空数组' });
    const results = await batchRewrite(answers, options);
    res.json({ success: true, results, total: results.length });
  } catch (err) {
    console.error('[Rewrite API] 批量改写失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取可用语气列表
router.get('/rewrite-tones', (req, res) => {
  try {
    const tones = getToneList();
    res.json({ success: true, tones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 评估改写质量
router.post('/rewrite-evaluate', (req, res) => {
  try {
    const { original, rewritten } = req.body;
    if (!original || !rewritten) return res.status(400).json({ error: 'original 和 rewritten 必填' });
    const evaluation = evaluateQuality(original, rewritten);
    res.json({ success: true, evaluation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 七、向量库管理 API
// ==========================================
router.get('/vector/stats', async (req, res) => {
  try {
    const stats = await getVectorStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 兼容前端请求路径（连字符）
router.get('/vector-stats', async (req, res) => {
  try {
    const stats = await getVectorStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ BM25 索引状态 ============
router.get('/bm25-stats', (req, res) => {
  try {
    res.json(getBM25Stats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ RAG 测试搜索 ============
router.post('/rag-test', async (req, res) => {
  try {
    const { query, topK = 5 } = req.body;
    if (!query) return res.status(400).json({ error: 'query 必填' });
    const results = semanticSearch(query, topK);
    res.json({ success: true, query, count: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ RAG 批量评估 ============
router.post('/rag-eval', async (req, res) => {
  try {
    const { samples } = req.body;
    if (!samples || !Array.isArray(samples)) return res.status(400).json({ error: 'samples 必须是数组' });
    res.json({ success: true, message: '评估任务已启动，请稍候...' });
    // 异步执行评估，不阻塞响应
    setImmediate(async () => {
      const report = { timestamp: new Date().toISOString(), total: samples.length, results: [] };
      for (const s of samples) {
        try {
          const results = semanticSearch(s.query || s.question, 3);
          const safeResults = Array.isArray(results) ? results : [];
          report.results.push({ query: s.query || s.question, results: safeResults.slice(0, 3) });
        } catch (e) {
          report.results.push({ query: s.query || s.question, error: e.message });
        }
      }
      const fp = path.join(__dirname, '..', 'data', 'rag-eval-latest.json');
      fs.writeFileSync(fp, JSON.stringify(report, null, 2), 'utf8');
      console.log('[RAG] 评估报告已保存至', fp);
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 获取最新评估报告 ============
router.get('/eval-report-latest', (req, res) => {
  try {
    const fp = path.join(__dirname, '..', 'data', 'rag-eval-latest.json');
    if (!fs.existsSync(fp)) return res.status(404).json({ error: '评估报告尚未生成' });
    res.json(JSON.parse(fs.readFileSync(fp, 'utf8')));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/vector/rebuild', async (req, res) => {
  try {
    auditLog('vector_rebuild', req.user ? req.user.username : 'unknown', { category: req.body && req.body.category || 'all' });
    res.json({ success: true, message: '向量库重建中，请稍候...' });
    rebuildVectorStore()
      .then(r => console.log('[RAG] 向量库重建完成，共', r.count, '个文档'))
      .catch(e => console.error('[RAG] 向量库重建失败：', e.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 八、上传文件管理 API
// ==========================================
router.get('/uploads', (req, res) => {
  try {
    const dir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(dir)) return res.json([]);
    const files = fs.readdirSync(dir).map(f => {
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      const ext = path.extname(f).toLowerCase();
      const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext);
      return { name: f, url: `/uploads/${f}`, isImage, size: stat.size, uploadedAt: stat.mtime };
    });
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/uploads/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const fp = path.join(__dirname, 'uploads', filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    auditLog('upload_delete', req.user ? req.user.username : 'unknown', { filename: req.params.filename });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 图片/附件上传（供 FAQ 答案插入图片/链接使用）
router.post('/upload-media', uploadSingleWithErrorHandler(uploadMedia, 'file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const file = req.file;
    const originalName = req.body.originalName && req.body.originalName.trim()
      ? req.body.originalName.trim()
      : file.originalname;
    console.log('[媒体上传] 收到文件：', originalName);
    const ext = path.extname(originalName).toLowerCase();
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext);
    const url = `/uploads/${file.filename}${ext}`;
    const newPath = path.join(__dirname, 'uploads', `${file.filename}${ext}`);
    fs.renameSync(file.path, newPath);
    console.log('[媒体上传] 成功：', url, '原始名：', originalName);
    auditLog('media_upload', req.user ? req.user.username : 'unknown', { originalName, isImage });
    res.json({
      success: true,
      url,
      originalName,
      isImage,
      markdown: isImage ? `![${originalName}](${url})` : `[📎 ${originalName}](${url})`
    });
  } catch (err) {
    console.error('[媒体上传] 失败：', err);
    res.status(500).json({ error: err.message });
  }
});


// ============ 九、日志管理 API ============
// 获取日志文件列表（?summary=true 附带行数 + 各级别计数）
router.get('/logs', (req, res) => {
  try {
    const summary = req.query.summary === 'true' || req.query.summary === '1';
    const files = getLogFiles({ summary });
    res.json({ success: true, data: files });
  } catch (err) {
    errorLog('获取日志文件列表失败', err);
    res.status(500).json({ error: err.message });
  }
});

// 读取日志文件内容（支持 limit / level / search 过滤）
router.get('/logs/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const { limit = 100, level = null, search = null } = req.query;
    const logs = readLogFile(filename, Number(limit), level, search);
    res.json({ success: true, data: logs, total: logs.length });
  } catch (err) {
    errorLog('读取日志文件失败', err, { filename: req.params.filename });
    res.status(500).json({ error: err.message });
  }
});

// 清理旧日志
router.post('/logs/clean', (req, res) => {
  try {
    const { daysToKeep = 7 } = req.body;
    cleanOldLogs(Number(daysToKeep));
    auditLog('logs_clean', req.user ? req.user.username : 'unknown', { daysToKeep });
    res.json({ success: true, message: `已清理${daysToKeep}天前的日志` });
  } catch (err) {
    errorLog('清理旧日志失败', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ 对话记录 & 满意度 API ============
const DB_PATH = path.join(__dirname, '../data/conversations.db');

function readDB() {
  const fp = DB_PATH.replace('.db', '.json');
  if (!fs.existsSync(fp)) return { conversations: [], faq_logs: [] };
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    if (!raw.trim()) return { conversations: [], faq_logs: [] }; // 空文件保护
    return JSON.parse(raw);
  } catch (e) {
    // JSON 解析失败时返回空数据，避免 500 崩溃
    errorLog('读取数据文件失败（将使用空数据）', e);
    return { conversations: [], faq_logs: [] };
  }
}

function writeDB(data) {
  const fp = DB_PATH.replace('.db', '.json');
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

// 将对话记录的 user_id 关联出用户姓名（用于后台对话管理展示咨询人）
function enrichConversation(conv) {
  const result = {
    ...conv,
    messages: typeof conv.messages === 'string' ? JSON.parse(conv.messages || '[]') : conv.messages
  };
  if (conv.user_id) {
    const u = auth.findUserById(conv.user_id);
    result.user_name = u ? (u.name || u.username) : '未知用户';
    result.username = u ? u.username : '';
  } else {
    result.user_name = '匿名用户';
    result.username = '';
  }
  return result;
}

// 获取对话列表（分页）
router.get('/conversations', (req, res) => {
  try {
    const db = readDB();
    const { limit = 100, offset = 0, department } = req.query;
    let convs = db.conversations;
    // 多部门隔离：仅当开关开启且指定 department 时按部门过滤
    if (department) {
      const cfg = loadSystemConfig();
      if (cfg.multiDeptEnabled) {
        convs = convs.filter(c => (c.department || cfg.defaultDepartment || '') === String(department));
      }
    }
    const slice = convs.slice(Number(offset), Number(offset) + Number(limit));
    res.json(slice.map(c => enrichConversation(c)));
  } catch (err) {
    errorLog('获取对话列表失败', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取单个对话详情
router.get('/conversations/:sessionId', (req, res) => {
  try {
    const db = readDB();
    const conv = db.conversations.find(c => c.session_id === req.params.sessionId);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    res.json(enrichConversation(conv));
  } catch (err) {
    errorLog('获取对话详情失败', err);
    res.status(500).json({ error: err.message });
  }
});

// 删除单个对话
router.delete('/conversations/:sessionId', (req, res) => {
  try {
    const db = readDB();
    const before = db.conversations.length;
    db.conversations = db.conversations.filter(c => c.session_id !== req.params.sessionId);
    if (db.conversations.length === before) return res.status(404).json({ error: 'Not found' });
    writeDB(db);
    auditLog('删除对话记录', `session_id=${req.params.sessionId}`, req.user);
    res.json({ success: true });
  } catch (err) {
    errorLog('删除对话记录失败', err);
    res.status(500).json({ error: err.message });
  }
});

// 批量删除对话
router.post('/conversations/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids 必须是非空数组' });
    const db = readDB();
    const before = db.conversations.length;
    db.conversations = db.conversations.filter(c => !ids.includes(c.session_id));
    const deleted = before - db.conversations.length;
    if (deleted === 0) return res.status(404).json({ error: '未找到要删除的记录' });
    writeDB(db);
    auditLog('批量删除对话记录', `删除${deleted}条`, req.user);
    res.json({ success: true, deleted });
  } catch (err) {
    errorLog('批量删除对话失败', err);
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// 九、对话记忆管理 API
// ==========================================
// 获取对话历史
router.get('/memory/:sessionId', (req, res) => {
  try {
    const history = getConversationHistory(req.params.sessionId);
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 增强查询（带记忆上下文）
router.post('/memory/enhance-query', (req, res) => {
  try {
    const { sessionId, query } = req.body;
    if (!sessionId || !query) return res.status(400).json({ error: 'sessionId 和 query 必填' });
    const enhanced = enhanceQueryWithMemory(sessionId, query);
    res.json({ success: true, original: query, enhanced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取记忆统计
router.get('/memory/stats', (req, res) => {
  try {
    const stats = getMemoryStats();
    // 关联用户姓名（sessionId 实际为 userId）
    const nameCache = {};
    const getName = (uid) => {
      if (!uid) return { user_name: '匿名用户', username: '' };
      if (nameCache[uid]) return nameCache[uid];
      let info;
      const u = auth.findUserById(uid);
      if (u) {
        info = { user_name: u.name || u.username, username: u.username };
      } else if (uid.startsWith('user')) {
        info = { user_name: uid, username: '' };
      } else {
        info = { user_name: '匿名会话', username: uid };
      }
      nameCache[uid] = info;
      return info;
    };
    if (Array.isArray(stats.sessions)) {
      stats.sessions = stats.sessions.map(s => {
        const { user_name, username } = getName(s.sessionId);
        return { ...s, user_name, username };
      });
    }
    if (stats.user_memories && typeof stats.user_memories === 'object') {
      stats.user_memories_list = Object.entries(stats.user_memories).map(([uid, count]) => {
        const { user_name, username } = getName(uid);
        return { userId: uid, user_name, username, count };
      });
    }
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清除对话历史
router.delete('/memory/:sessionId', (req, res) => {
  try {
    const result = clearConversationHistory(req.params.sessionId);
    auditLog('memory_clear', req.user ? req.user.username : 'unknown', { sessionId: req.params.sessionId });
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 十、基础信息管理 API
// ==========================================

// ============ 组织架构管理 ============
router.get('/org', (req, res) => {
  try { res.json(loadOrg()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/org', (req, res) => {
  try {
    const { name, parentId, description, type, code } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '名称必填' });
    const nodeType = type === 'dept' ? 'dept' : 'org';
    const list = loadOrg();
    const newOrg = {
      id: (nodeType === 'dept' ? 'dept_' : 'org_') + Date.now(),
      name: name.trim(),
      parentId: parentId || null,
      type: nodeType,
      sortOrder: list.length,
      description: description || '',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (nodeType === 'dept') newOrg.code = (code || '').trim();
    list.push(newOrg);
    saveOrg(list);
    auditLog(nodeType === 'dept' ? '新增部门' : 'org_create', req.user ? req.user.username : 'unknown', { id: newOrg.id, name: newOrg.name });
    res.json({ success: true, data: newOrg });
  } catch (err) {
    errorLog('新增组织/部门失败', err, req.body);
    res.status(500).json({ error: err.message });
  }
});

router.put('/org/:id', (req, res) => {
  try {
    const list = loadOrg();
    const idx = list.findIndex(o => o.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const { name, parentId, description, isActive, sortOrder, type, code } = req.body;
    if (name && name.trim()) list[idx].name = name.trim();
    if (parentId !== undefined) list[idx].parentId = parentId || null;
    if (description !== undefined) list[idx].description = description;
    if (isActive !== undefined) list[idx].isActive = isActive;
    if (sortOrder !== undefined) list[idx].sortOrder = sortOrder;
    if (type !== undefined) list[idx].type = type === 'dept' ? 'dept' : 'org';
    if (code !== undefined) list[idx].code = code;
    list[idx].updatedAt = new Date().toISOString();
    saveOrg(list);
    auditLog('org_update', req.user ? req.user.username : 'unknown', { id: req.params.id, name: (name || '').trim(), type: list[idx].type });
    res.json({ success: true, data: list[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/org/:id', (req, res) => {
  try {
    let list = loadOrg();
    const hasChildren = list.some(o => o.parentId === req.params.id);
    if (hasChildren) return res.status(400).json({ error: '请先删除子组织' });
    const newList = list.filter(o => o.id !== req.params.id);
    if (newList.length === list.length) return res.status(404).json({ error: 'Not found' });
    saveOrg(newList);
    auditLog('org_delete', req.user ? req.user.username : 'unknown', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 基础信息：人员信息管理 ============
router.get('/personnel', (req, res) => {
  try {
    const list = loadPersonnel();
    const { orgId, department } = req.query;
    let filtered = list;
    if (orgId) filtered = filtered.filter(p => p.orgId === orgId);
    // 多部门隔离：仅当开关开启且指定 department 时按部门过滤
    if (department) {
      const cfg = loadSystemConfig();
      if (cfg.multiDeptEnabled) {
        filtered = filtered.filter(p => (p.department || cfg.defaultDepartment || '') === String(department));
      }
    }
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/personnel', (req, res) => {
  try {
    const { name, username, password, orgId, orgName, roleId, roleName } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '姓名必填' });
    if (!username || !username.trim()) return res.status(400).json({ error: '用户名必填' });
    const list = loadPersonnel();
    if (list.some(p => p.username === username.trim())) return res.status(400).json({ error: '用户名已存在' });
    const newPerson = {
      id: 'user_' + Date.now(),
      name: name.trim(),
      username: username.trim(),
      passwordHash: hashPassword(password || '123456'),  // 存储密码哈希
      orgId: orgId || null,
      orgName: orgName || '',
      roleId: roleId || null,
      roleName: roleName || '',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: null
    };
    list.push(newPerson);
    savePersonnel(list);
    auditLog('personnel_create', req.user ? req.user.username : 'unknown', { id: newPerson.id, name: newPerson.name, username: newPerson.username });
    res.json({ success: true, data: newPerson });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/personnel/:id', (req, res) => {
  try {
    const list = loadPersonnel();
    const idx = list.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const { name, username, password, orgId, orgName, roleId, roleName, isActive } = req.body;
    if (name && name.trim()) list[idx].name = name.trim();
    if (username && username.trim()) {
      if (list.some(p => p.username === username.trim() && p.id !== req.params.id)) {
        return res.status(400).json({ error: '用户名已存在' });
      }
      list[idx].username = username.trim();
    }
    if (password && password.trim()) {
      list[idx].passwordHash = hashPassword(password.trim());  // 存储密码哈希
      delete list[idx].password;  // 删除明文密码字段（如果存在）
    }
    if (orgId !== undefined) { list[idx].orgId = orgId || null; list[idx].orgName = orgName || ''; }
    if (roleId !== undefined) { list[idx].roleId = roleId || null; list[idx].roleName = roleName || ''; }
    if (isActive !== undefined) list[idx].isActive = isActive;
    list[idx].updatedAt = new Date().toISOString();
    savePersonnel(list);
    auditLog('personnel_update', req.user ? req.user.username : 'unknown', { id: req.params.id, name: (name || '').trim(), username: (username || '').trim() });
    res.json({ success: true, data: list[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/personnel/:id', (req, res) => {
  try {
    const list = loadPersonnel();
    const newList = list.filter(p => p.id !== req.params.id);
    if (newList.length === list.length) return res.status(404).json({ error: 'Not found' });
    savePersonnel(newList);
    auditLog('personnel_delete', req.user ? req.user.username : 'unknown', { id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 人员密码重置 ============
router.put('/personnel/:id/reset-password', (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: '新密码至少4位' });
    }
    const list = loadPersonnel();
    const idx = list.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '人员不存在' });
    
    list[idx].passwordHash = hashPassword(newPassword);
    list[idx].updatedAt = new Date().toISOString();
    savePersonnel(list);
    auditLog('personnel_reset_password', req.user ? req.user.username : 'unknown', { id: req.params.id });
    res.json({ success: true, message: '密码已重置' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 基础信息：权限管理 ============
router.get('/permissions/catalog', (req, res) => {
  try { res.json({ success: true, data: data.PERMISSION_CATALOG }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ 基础信息：软件信息（可编辑品牌/名称） ============
router.get('/software-info', (req, res) => {
  try { res.json({ success: true, data: data.loadSoftwareInfo() }); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/software-info', (req, res) => {
  try {
    const saved = data.saveSoftwareInfo(req.body || {});
    auditLog('software_info_update', req.user ? req.user.username : 'unknown', { name: saved.name });
    res.json({ success: true, data: saved });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/permissions', (req, res) => {
  try { res.json(loadPermissions()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/permissions', (req, res) => {
  try {
    const { roleName, categoryId, categoryName, permissions } = req.body;
    if (!roleName || !roleName.trim()) return res.status(400).json({ error: '角色名称必填' });
    const list = loadPermissions();
    const newRole = {
      id: 'perm_' + Date.now(),
      roleName: roleName.trim(),
      roleKey: roleName.trim().replace(/\s+/g, '_').toLowerCase(),
      categoryId: categoryId || null,
      categoryName: categoryName || '全部',
      permissions: permissions || [],
      isSystem: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    list.push(newRole);
    savePermissions(list);
    auditLog('permission_create', req.user ? req.user.username : 'unknown', { id: newRole.id, roleName: newRole.roleName });
    res.json({ success: true, data: newRole });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/permissions/:id', (req, res) => {
  try {
    const list = loadPermissions();
    const idx = list.findIndex(r => r.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    if (list[idx].isSystem) return res.status(400).json({ error: '系统内置角色不可修改' });
    const { roleName, categoryId, categoryName, permissions } = req.body;
    if (roleName && roleName.trim()) list[idx].roleName = roleName.trim();
    if (categoryId !== undefined) { list[idx].categoryId = categoryId || null; list[idx].categoryName = categoryName || '全部'; }
    if (permissions) list[idx].permissions = permissions;
    list[idx].updatedAt = new Date().toISOString();
    savePermissions(list);
    auditLog('permission_update', req.user ? req.user.username : 'unknown', { id: req.params.id, roleName: (roleName || '').trim() });
    res.json({ success: true, data: list[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/permissions/:id', (req, res) => {
  try {
    const list = loadPermissions();
    const target = list.find(r => r.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.isSystem) return res.status(400).json({ error: '系统内置角色不可删除' });
    const newList = list.filter(r => r.id !== req.params.id);
    savePermissions(newList);
    auditLog('permission_delete', req.user ? req.user.username : 'unknown', { id: req.params.id, roleName: target.roleName });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 基础信息：A8配置管理 ============
router.get('/a8-config', (req, res) => {
  try { res.json(loadA8Config()); } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/a8-config', (req, res) => {
  try {
    const config = loadA8Config();
    const { enabled, orgApiUrl, personnelApiUrl, syncInterval, auth } = req.body;
    if (enabled !== undefined) config.enabled = enabled;
    if (orgApiUrl !== undefined) config.orgApiUrl = orgApiUrl;
    if (personnelApiUrl !== undefined) config.personnelApiUrl = personnelApiUrl;
    if (syncInterval !== undefined) config.syncInterval = syncInterval;
    if (auth) config.auth = auth;
    config.updatedAt = new Date().toISOString();
    saveA8Config(config);
    auditLog('a8_config_update', req.user ? req.user.username : 'unknown', { enabled: config.enabled });
    res.json({ success: true, data: config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/a8-test', async (req, res) => {
  try {
    const config = loadA8Config();
    if (!config.enabled) return res.status(400).json({ error: 'A8集成未启用' });
    if (!config.orgApiUrl) return res.status(400).json({ error: '请先配置组织架构API地址' });
    const axios = require('axios');
    const authHeader = config.auth.type === 'basic'
      ? { Authorization: 'Basic ' + Buffer.from(config.auth.username + ':' + config.auth.password).toString('base64') }
      : {};
    const response = await axios.get(config.orgApiUrl, { headers: authHeader, timeout: 5000 });
    res.json({ success: true, message: '连接成功', status: response.status });
  } catch (err) {
    res.status(500).json({ error: '连接失败：' + (err.response?.data || err.message) });
  }
});

router.post('/a8-sync', async (req, res) => {
  try {
    const config = loadA8Config();
    if (!config.enabled) return res.status(400).json({ error: 'A8集成未启用' });
    // TODO: 实现同步逻辑
    config.lastSyncTime = new Date().toISOString();
    saveA8Config(config);
    auditLog('a8_sync', req.user ? req.user.username : 'unknown', {});
    res.json({ success: true, message: '同步完成' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 模型自动切换管理 ============
const modelSwitcher = require('./model-switcher');
const { generatePerformancePage } = require('./performance-page');

// 获取当前模型状态（增强版 - 包含性能数据）
router.get('/models/status', (req, res) => {
  try {
    const status = modelSwitcher.getHealthStatus();
    const performance = modelSwitcher.getPerformanceReport();
    
    res.json({
      success: true,
      currentModels: status.currentModels,
      health: status.modelHealth,
      performance,  // 新增：性能数据
      config: modelSwitcher.getModelConfig(),  // 完整配置（含 reranker.serviceUrl、timeout 等）
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 获取详细性能报告（新增）
router.get('/models/performance', (req, res) => {
  try {
    const { type } = req.query;
    const report = modelSwitcher.getPerformanceReport(type);
    
    if (!report) {
      return res.status(400).json({ success: false, error: `未知的模型类型: ${type}` });
    }
    
    res.json({
      success: true,
      report,
      timestamp: Date.now(),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 重置性能统计（新增）
router.post('/models/performance/reset', (req, res) => {
  try {
    const { type } = req.body;
    modelSwitcher.resetPerformanceStats(type);
    auditLog('model_perf_reset', req.user ? req.user.username : 'unknown', { type: type || 'all' });
    res.json({
      success: true,
      message: type ? '已重置 ' + type + ' 性能统计' : '已重置所有模型性能统计',
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 手动切换模型（用于测试）
router.post('/models/switch', (req, res) => {
  try {
    const { type, modelName } = req.body;
    
    if (!type || !modelName) {
      return res.status(400).json({ success: false, error: '缺少 type 或 modelName 参数' });
    }
    
    const result = modelSwitcher.switchModel(type, modelName);
    auditLog('model_switch', req.user ? req.user.username : 'unknown', { type, modelName });
    res.json(result);
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ============ 模型配置读写（新增：可动态配置所有模型并热生效） ============

// 读取完整模型配置（供「模型设置」TAB 编辑表单初始化）
router.get('/models/config', (req, res) => {
  try {
    res.json({
      success: true,
      config: modelSwitcher.getModelConfig(),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 写入（合并）模型配置：body 形如 { embedding?: {...}, llm?: {...}, reranker?: {...} }
router.post('/models/config', (req, res) => {
  try {
    const partial = req.body && req.body.config ? req.body.config : req.body;
    if (!partial || typeof partial !== 'object') {
      return res.status(400).json({ success: false, error: '请求体缺少 config 对象' });
    }
    const result = modelSwitcher.setModelConfig(partial);
    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }
    auditLog('model_config_update', req.user ? req.user.username : 'unknown', {
      updated: Object.keys(partial),
    });
    res.json({
      success: true,
      message: '模型配置已保存并热生效',
      config: result.config,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});




// 恢复默认配置：用部署基线覆盖当前配置（清除用户修改，回到 model-config.default.json）
router.post('/models/config/reset', (req, res) => {
  try {
    const result = modelSwitcher.resetModelConfig();
    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error || '恢复默认配置失败' });
    }
    auditLog('model_config_reset', req.user ? req.user.username : 'unknown', {});
    res.json({
      success: true,
      message: '已恢复为默认模型配置并热生效',
      config: result.config,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 测试单个模型连接是否可达（供「测试连接」按钮；支持按表单当前值实时探测）
router.post('/models/test', async (req, res) => {
  try {
    const { type, primary, serviceUrl, baseUrl, timeout } = req.body || {};
    if (!type || !['embedding', 'llm', 'reranker'].includes(type)) {
      return res.status(400).json({ success: false, error: '缺少或非法的 type 参数（应为 embedding/llm/reranker）' });
    }
    const opts = {};
    if (primary !== undefined) opts.primary = primary;
    if (serviceUrl !== undefined) opts.serviceUrl = serviceUrl;
    if (baseUrl !== undefined) opts.baseUrl = baseUrl;
    if (timeout !== undefined) opts.timeout = timeout;
    const result = await modelSwitcher.testConnection(type, opts);
    res.json({
      success: true,
      type,
      available: result.available,
      error: result.error || null,
      responseTime: result.responseTime || 0,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// 性能监控页面（集成到管理后台）
router.get('/performance', (req, res) => {
  try {
    // 依赖 auth.adminOnly 中间件验证，req.user 已设置
    const token = req.headers['authorization'] || req.headers['Authorization'] || '';
    const realToken = token.replace('Bearer ', '');
    
    // 生成性能监控页面HTML
    const html = generatePerformancePage(realToken);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send('页面生成失败: ' + e.message);
  }
});

// ==========================================
// 十、统一系统配置
// ==========================================
router.get('/config', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    res.json({ success: true, data: loadSystemConfig() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/config', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const updated = saveSystemConfig(req.body || {});
    auditLog('更新系统配置', req.user ? req.user.username : 'unknown', { keys: Object.keys(req.body || {}) });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 十一、系统公告 / Banner
// ==========================================
router.get('/announcement', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    res.json({ success: true, data: loadAnnouncement() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/announcement', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const prev = loadAnnouncement();
    const body = req.body || {};
    const updated = saveAnnouncement({
      enabled: body.enabled !== undefined ? !!body.enabled : prev.enabled,
      title: body.title || '',
      content: body.content || '',
      level: ['info', 'warning', 'success', 'error'].includes(body.level) ? body.level : (prev.level || 'info'),
      updatedAt: new Date().toISOString(),
      updatedBy: req.user ? req.user.username : 'unknown'
    });
    auditLog('更新系统公告', req.user ? req.user.username : 'unknown', { enabled: updated.enabled, title: updated.title });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 十二、SSO 白名单（独立数据源 + 审计）
// ==========================================
// 启动时若白名单文件不存在，则从 oa-config.json 的 sso.whitelist 初始化（兼容旧数据）
(function seedSSOWhitelist() {
  try {
    if (!fs.existsSync(SSO_WHITELIST_PATH)) {
      const oaPath = path.join(__dirname, '../data/oa-config.json');
      let legacy = [];
      try { legacy = (JSON.parse(fs.readFileSync(oaPath, 'utf8')).sso || {}).whitelist || []; } catch (e) {}
      const now = new Date().toISOString();
      const seed = (Array.isArray(legacy) ? legacy : []).map(acc => ({
        account: String(acc), name: '', note: '从 oa-config 迁移', addedBy: 'system', addedAt: now
      }));
      saveSSOWhitelist(seed);
      console.log(`[init] SSO 白名单已从 oa-config 迁移 ${seed.length} 条到 ${path.basename(SSO_WHITELIST_PATH)}`);
    }
  } catch (e) { errorLog('SSO 白名单初始化失败', e); }
})();

// 将白名单账号同步回 oa-config.json（保证现有 SSO 登录逻辑无需改动即可生效）
function syncOAConfigWhitelist(accounts) {
  try {
    const oaPath = path.join(__dirname, '../data/oa-config.json');
    const cfg = JSON.parse(fs.readFileSync(oaPath, 'utf8'));
    cfg.sso = cfg.sso || {};
    cfg.sso.whitelist = accounts.map(String);
    fs.writeFileSync(oaPath, JSON.stringify(cfg, null, 2));
  } catch (e) { errorLog('同步 oa-config 白名单失败', e); }
}

// 将白名单条目与人员信息关联，补全姓名/部门（人员 username === 白名单 account）
function enrichSSOEntries(list) {
  const personnelMap = {};
  try {
    const personnel = loadPersonnel() || [];
    personnel.forEach(p => { if (p && p.username) personnelMap[p.username] = p; });
  } catch (e) { errorLog('读取人员信息失败', e); }
  return (list || []).map(x => {
    const p = personnelMap[x.account] || {};
    return {
      ...x,
      name: (x.name && String(x.name).trim()) ? x.name : (p.name || ''),
      department: p.orgName || ''
    };
  });
}

router.get('/sso-whitelist', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const all = enrichSSOEntries(loadSSOWhitelist());
    const filtered = q
      ? all.filter(x =>
          (x.account || '').toLowerCase().includes(q) ||
          (x.name || '').toLowerCase().includes(q) ||
          (x.department || '').toLowerCase().includes(q) ||
          (x.addedBy || '').toLowerCase().includes(q) ||
          (x.note || '').toLowerCase().includes(q))
      : all;
    res.json({ success: true, data: filtered, total: all.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sso-whitelist', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const { account, name, note } = req.body || {};
    const acc = (account || '').toString().trim();
    if (!acc) return res.status(400).json({ error: '账号(工号)必填' });
    const list = loadSSOWhitelist();
    if (list.some(x => x.account === acc)) return res.status(400).json({ error: '该账号已在白名单中' });
    const entry = { account: acc, name: (name || '').trim(), note: (note || '').trim(), addedBy: req.user ? req.user.username : 'unknown', addedAt: new Date().toISOString() };
    list.push(entry);
    saveSSOWhitelist(list);
    syncOAConfigWhitelist(list.map(x => x.account));
    auditLog('新增SSO白名单', req.user ? req.user.username : 'unknown', { account: acc });
    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sso-whitelist/:account', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const acc = decodeURIComponent(req.params.account);
    const list = loadSSOWhitelist();
    const before = list.length;
    const next = list.filter(x => x.account !== acc);
    if (next.length === before) return res.status(404).json({ error: '白名单中未找到该账号' });
    saveSSOWhitelist(next);
    syncOAConfigWhitelist(next.map(x => x.account));
    auditLog('删除SSO白名单', req.user ? req.user.username : 'unknown', { account: acc });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 批量移除白名单
router.post('/sso-whitelist/batch-delete', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const accounts = Array.isArray(req.body && req.body.accounts) ? req.body.accounts.map(String) : [];
    if (!accounts.length) return res.status(400).json({ error: '请提供要移除的账号列表' });
    const list = loadSSOWhitelist();
    const set = new Set(accounts);
    const before = list.length;
    const next = list.filter(x => !set.has(x.account));
    const removed = before - next.length;
    if (removed === 0) return res.status(404).json({ error: '白名单中未找到指定账号' });
    saveSSOWhitelist(next);
    syncOAConfigWhitelist(next.map(x => x.account));
    auditLog('批量删除SSO白名单', req.user ? req.user.username : 'unknown', { count: removed });
    res.json({ success: true, removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 十三、同义词 / 停用词
// ==========================================
router.get('/synonyms', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try { res.json({ success: true, data: loadSynonyms() }); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/synonyms', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const { words, note } = req.body || {};
    if (!Array.isArray(words) || words.length < 2) return res.status(400).json({ error: '同义词至少需 2 个词' });
    const list = loadSynonyms();
    const entry = { id: 'syn_' + Date.now(), words: words.map(w => String(w).trim()).filter(Boolean), note: (note || '').trim(), createdAt: new Date().toISOString() };
    list.push(entry);
    saveSynonyms(list);
    auditLog('新增同义词组', req.user ? req.user.username : 'unknown', { words: entry.words });
    res.json({ success: true, data: entry });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/synonyms/:id', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const list = loadSynonyms();
    const next = list.filter(x => x.id !== req.params.id);
    if (next.length === list.length) return res.status(404).json({ error: '未找到该同义词组' });
    saveSynonyms(next);
    auditLog('删除同义词组', req.user ? req.user.username : 'unknown', { id: req.params.id });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/stopwords', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try { res.json({ success: true, data: loadStopwords() }); } catch (err) { res.status(500).json({ error: err.message }); }
});
router.post('/stopwords', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const { word } = req.body || {};
    const w = (word || '').toString().trim();
    if (!w) return res.status(400).json({ error: '停用词必填' });
    const list = loadStopwords();
    if (list.includes(w)) return res.status(400).json({ error: '该停用词已存在' });
    list.push(w);
    saveStopwords(list);
    auditLog('新增停用词', req.user ? req.user.username : 'unknown', { word: w });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
router.delete('/stopwords/:word', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const w = decodeURIComponent(req.params.word);
    const list = loadStopwords();
    const next = list.filter(x => x !== w);
    if (next.length === list.length) return res.status(404).json({ error: '未找到该停用词' });
    saveStopwords(next);
    auditLog('删除停用词', req.user ? req.user.username : 'unknown', { word: w });
    res.json({ success: true, data: next });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 为人员打部门标签（多部门隔离的数据归属）
// 说明：部门已是组织树（org_structure.json）中 type==='dept' 的节点，
// 此处 department 字段存的就是该组织树节点的 id。
router.put('/personnel/:id/department', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const { department } = req.body || {};
    const list = loadPersonnel();
    const idx = list.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: '人员不存在' });
    list[idx].department = department || '';
    savePersonnel(list);
    auditLog('人员归属部门', req.user ? req.user.username : 'unknown', { id: req.params.id, department: department || '' });
    res.json({ success: true, data: list[idx] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// 十五、操作审计查询
// ==========================================
router.get('/audit-logs', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const LOGS_DIR = path.join(__dirname, '../logs');
    const { operation, operator, date, dateFrom, dateTo, limit = 200, offset = 0 } = req.query;
    if (!fs.existsSync(LOGS_DIR)) return res.json({ success: true, data: [], total: 0 });
    let files = fs.readdirSync(LOGS_DIR).filter(f => f.endsWith('.log'));
    if (date) files = files.filter(f => f.startsWith(String(date)));
    if (dateFrom || dateTo) {
      const from = dateFrom ? String(dateFrom) : '0000-00-00';
      const to = dateTo ? String(dateTo) : '9999-99-99';
      files = files.filter(f => {
        const fd = f.slice(0, 10);
        return fd >= from && fd <= to;
      });
    }
    files.sort((a, b) => b.localeCompare(a)); // 新日期优先
    const out = [];
    const opQ = operation ? String(operation).toLowerCase() : '';
    const opQ2 = operator ? String(operator).toLowerCase() : '';
    for (const f of files) {
      const raw = fs.readFileSync(path.join(LOGS_DIR, f), 'utf8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        let log;
        try { log = JSON.parse(line); } catch (e) { continue; }
        if (log.level !== 'AUDIT') continue;
        if (opQ && !String(log.operation || '').toLowerCase().includes(opQ)) continue;
        if (opQ2 && !String(log.operator || '').toLowerCase().includes(opQ2)) continue;
        out.push(log);
      }
    }
    out.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    const total = out.length;
    const paged = out.slice(Number(offset), Number(offset) + Number(limit));
    res.json({ success: true, data: paged, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 十六、配置备份 / 恢复
// ==========================================
function buildConfigBundle() {
  return {
    exportedAt: new Date().toISOString(),
    version: 1,
    data: {
      systemConfig: loadSystemConfig(),
      softwareInfo: loadSoftwareInfo ? loadSoftwareInfo() : undefined,
      a8Config: loadA8Config(),
      synonyms: loadSynonyms(),
      stopwords: loadStopwords(),
      announcement: loadAnnouncement(),
      ssoWhitelist: loadSSOWhitelist(),
      // 部门已是组织树中 type==='dept' 的节点，从 org 树派生
      departments: loadOrg().filter((n) => n.type === 'dept'),
      permissions: loadPermissions(),
      categories: loadCategories(),
      knowledgeBases: loadKnowledgeBases(),
      faq: getFAQ()
    }
  };
}

router.get('/config/export', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const bundle = buildConfigBundle();
    auditLog('导出系统配置', req.user ? req.user.username : 'unknown', {});
    res.setHeader('Content-Disposition', `attachment; filename="system-config-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(bundle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/config/import', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const body = req.body || {};
    const bundle = body.bundle || body; // 兼容直接传 bundle 或 {bundle}
    const d = bundle && bundle.data ? bundle.data : null;
    if (!d) return res.status(400).json({ error: '无效的配置包' });
    const scope = Array.isArray(body.scope) ? body.scope : null; // 可选：仅恢复指定模块
    const imported = [];
    const apply = (key, fn) => {
      if (scope && !scope.includes(key)) return;
      if (d[key] !== undefined) { fn(d[key]); imported.push(key); }
    };
    apply('systemConfig', saveSystemConfig);
    apply('softwareInfo', saveSoftwareInfo);
    apply('a8Config', saveA8Config);
    apply('synonyms', saveSynonyms);
    apply('stopwords', saveStopwords);
    apply('announcement', saveAnnouncement);
    apply('ssoWhitelist', (v) => { saveSSOWhitelist(v); syncOAConfigWhitelist(v.map(x => x.account)); });
    // 部门节点合并回组织树（保留非部门节点）
    apply('departments', (depts) => {
      const org = loadOrg();
      const others = org.filter((n) => n.type !== 'dept');
      saveOrg([...others, ...depts]);
    });
    apply('permissions', savePermissions);
    apply('categories', saveCategories);
    apply('knowledgeBases', saveKnowledgeBases);
    apply('faq', saveFAQ);
    auditLog('导入系统配置', req.user ? req.user.username : 'unknown', { scope: scope || 'all', imported });
    res.json({ success: true, imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 七、数据备份管理 ============
const dataBackup = require('./data-backup');

// 当前待备份的数据文件清单
router.get('/backup/files', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try { res.json({ success: true, files: dataBackup.listSourceFiles() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 备份历史 + 当前配置
router.get('/backup/list', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try { res.json({ success: true, backups: dataBackup.listBackups(), config: dataBackup.loadConfig() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 立即创建备份
router.post('/backup/create', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const { manifest, removed } = dataBackup.createBackup();
    auditLog('数据备份_创建', req.user ? req.user.username : 'unknown', { id: manifest.id, files: manifest.files.length, removed });
    res.json({ success: true, manifest, removed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 从指定备份恢复（覆盖回 data/）
router.post('/backup/restore', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: 'id 必填' });
    const r = dataBackup.restoreBackup(id);
    auditLog('数据备份_恢复', req.user ? req.user.username : 'unknown', { id });
    res.json({ success: true, ...r });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// 读取自动备份配置
router.get('/backup/config', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try { res.json({ success: true, config: dataBackup.loadConfig() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 保存自动备份配置（enabled / retention）
router.put('/backup/config', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const { enabled, retention } = req.body || {};
    const cfg = dataBackup.loadConfig();
    if (enabled !== undefined) cfg.enabled = !!enabled;
    if (retention !== undefined) cfg.retention = Math.max(1, parseInt(retention) || 30);
    dataBackup.saveConfig(cfg);
    dataBackup.stopAutoBackup();
    dataBackup.startAutoBackup();
    auditLog('数据备份_配置', req.user ? req.user.username : 'unknown', { enabled: cfg.enabled, retention: cfg.retention });
    res.json({ success: true, config: cfg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除指定备份
router.delete('/backup/:id', auth.authMiddleware, auth.adminOnly, (req, res) => {
  try {
    const { id } = req.params;
    const ok = dataBackup.deleteBackup(id);
    if (!ok) return res.status(404).json({ error: '备份不存在' });
    auditLog('数据备份_删除', req.user ? req.user.username : 'unknown', { id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
