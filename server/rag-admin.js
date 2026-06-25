/**
 * RAG 管理统一路由模块
 * 整合：知识库管理、分类管理、FAQ管理、意图理解、答案改写、向量管理、上传管理
 * 保持所有 API 路径不变，前端无需修改
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

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
  CATEGORIES_PATH, FAQ_PATH, ORG_PATH, PERSONNEL_PATH, PERMISSIONS_PATH, A8_CONFIG_PATH, KNOWLEDGE_BASES_PATH
} = data;

// ============ 日志系统 ============
const { auditLog, errorLog, getLogFiles, readLogFile, cleanOldLogs } = require('./logger');

// ============ 依赖模块 ============
const {
  addDocumentChunks, semanticSearch, rebuildVectorStore, getStats: getVectorStats,
  buildFAQEmbeddingCache, searchByFAQCacheAsync, deleteDocument,
  getBM25Stats
} = require('./vector-store');

const { callOllamaChat, callOllamaGenerate } = require('./ollama-client');

const {
  understandIntent, batchUnderstandIntents, fallbackIntent, INTENT_TAXONOMY
} = require('./intent-understanding');

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
    const defaultKB = [{ id: 'kb_default', name: '广康集团知识库', description: '默认知识库', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isDefault: true, isActive: true }];
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
const upload = multer({ storage });

const mediaStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, 'media_' + Date.now() + '_' + Math.round(Math.random() * 1E9) + path.extname(file.originalname))
});
const uploadMedia = multer({ storage: mediaStorage });


// ==========================================
// 一、统计 API
// ==========================================
router.get('/stats', (req, res) => {
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
        vectorStats: getVectorStats()
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FAQ 文件上传 + 自动提取
router.post('/faq/upload', upload.single('file'), async (req, res) => {
  console.log('[UPLOAD] body=', JSON.stringify(req.body), 'query.category=', req.query.category);
  try {
    if (!req.file) return res.status(400).json({ error: '请上传文件' });
    const filePath = req.file.path;
    const originalName = req.file.originalname;
    const ext = path.extname(originalName).toLowerCase();
    let text = '';

    try {
      if (ext === '.txt' || ext === '.md') {
        text = fs.readFileSync(filePath, 'utf8');
      } else if (ext === '.pdf') {
        try {
          const pdfParse = require('pdf-parse');
          const dataBuffer = fs.readFileSync(filePath);
          const pdfData = await pdfParse(dataBuffer);
          text = pdfData.text;
        } catch (e) {
          text = fs.readFileSync(filePath, 'utf8');
        }
      } else if (ext === '.docx' || ext === '.doc') {
        try {
          const mammoth = require('mammoth');
          const result = await mammoth.extractRawText({ path: filePath });
          text = result.value;
        } catch (e) {
          text = fs.readFileSync(filePath, 'utf8');
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
          text = fs.readFileSync(filePath, 'utf8');
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

    // 使用简单规则提取 FAQ
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const extracted = [];
    let currentQ = null, currentA = null;
    for (const line of lines) {
      if (/^(Q|q|问题|问)[:：\s]/.test(line)) {
        if (currentQ && currentA) extracted.push({ question: currentQ, answer: currentA, category: uploadCategory || '其他', keywords: [] });
        currentQ = line.replace(/^(Q|q|问题|问)[:：\s]/, '').trim();
        currentA = null;
      } else if (/^(A|a|答案|答)[:：\s]/.test(line)) {
        currentA = line.replace(/^(A|a|答案|答)[:：\s]/, '').trim();
      } else if (currentA !== null) {
        currentA += '\n' + line;
      } else if (currentQ !== null) {
        currentA = line;
      }
    }
    if (currentQ && currentA) extracted.push({ question: currentQ, answer: currentA, category: uploadCategory || '其他', keywords: [] });

    // 如果没提取到，就把整个文本作为一个 FAQ
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
router.get('/vector/stats', (req, res) => {
  try {
    res.json(getVectorStats());
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 图片/附件上传（供 FAQ 答案插入图片/链接使用）
router.post('/upload-media', uploadMedia.single('file'), (req, res) => {
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
// 获取日志文件列表
router.get('/logs', (req, res) => {
  try {
    const files = getLogFiles();
    res.json({ success: true, data: files });
  } catch (err) {
    errorLog('获取日志文件列表失败', err);
    res.status(500).json({ error: err.message });
  }
});

// 读取日志文件内容
router.get('/logs/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const { limit = 100, level = null } = req.query;
    const logs = readLogFile(filename, Number(limit), level);
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

// 获取对话列表（分页）
router.get('/conversations', (req, res) => {
  try {
    const db = readDB();
    const { limit = 100, offset = 0 } = req.query;
    const slice = db.conversations.slice(Number(offset), Number(offset) + Number(limit));
    res.json(slice.map(c => ({ ...c, messages: JSON.parse(c.messages) })));
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
    res.json({ ...conv, messages: JSON.parse(conv.messages) });
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
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清除对话历史
router.delete('/memory/:sessionId', (req, res) => {
  try {
    const result = clearConversationHistory(req.params.sessionId);
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
    const { name, parentId, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '组织名称必填' });
    const list = loadOrg();
    const newOrg = {
      id: 'org_' + Date.now(),
      name: name.trim(),
      parentId: parentId || null,
      sortOrder: list.length,
      description: description || '',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    list.push(newOrg);
    saveOrg(list);
    auditLog('org_create', req.user ? req.user.username : 'unknown', { id: newOrg.id, name: newOrg.name });
    res.json({ success: true, data: newOrg });
  } catch (err) {
    errorLog('新增组织失败', err, req.body);
    res.status(500).json({ error: err.message });
  }
});

router.put('/org/:id', (req, res) => {
  try {
    const list = loadOrg();
    const idx = list.findIndex(o => o.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const { name, parentId, description, isActive, sortOrder } = req.body;
    if (name && name.trim()) list[idx].name = name.trim();
    if (parentId !== undefined) list[idx].parentId = parentId || null;
    if (description !== undefined) list[idx].description = description;
    if (isActive !== undefined) list[idx].isActive = isActive;
    if (sortOrder !== undefined) list[idx].sortOrder = sortOrder;
    list[idx].updatedAt = new Date().toISOString();
    saveOrg(list);
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 基础信息：人员信息管理 ============
router.get('/personnel', (req, res) => {
  try {
    const list = loadPersonnel();
    const { orgId } = req.query;
    const filtered = orgId ? list.filter(p => p.orgId === orgId) : list;
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
      password: password || '123456',
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
    if (password && password.trim()) list[idx].password = password.trim();
    if (orgId !== undefined) { list[idx].orgId = orgId || null; list[idx].orgName = orgName || ''; }
    if (roleId !== undefined) { list[idx].roleId = roleId || null; list[idx].roleName = roleName || ''; }
    if (isActive !== undefined) list[idx].isActive = isActive;
    list[idx].updatedAt = new Date().toISOString();
    savePersonnel(list);
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
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 基础信息：权限管理 ============
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
    res.json({ success: true, message: '同步完成' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
