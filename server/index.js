const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const multer = require('multer');

// ============ RAG 向量存储 ============
const {
  addDocumentChunks, semanticSearch, rebuildVectorStore, getStats: getVectorStats,
  buildFAQEmbeddingCache, searchByFAQCacheAsync
} = require('./vector-store');

// 共享 LLM 调用模块（消除各模块中的重复 HTTP 调用代码）
const { callOllamaChat, callOllamaGenerate } = require('./ollama-client');

// ============ 配置 ============
const OLLAMA_BASE_URL = 'http://172.17.6.18:11434';
const OLLAMA_CHAT_PATH = '/v1/chat/completions';
const OLLAMA_URL = OLLAMA_BASE_URL + OLLAMA_CHAT_PATH;  // 完整URL（兼容旧代码）
const MODEL_NAME = 'qwen2.5:14b';
const DB_PATH = path.join(__dirname, '../data/conversations.db');
const FAQ_PATH = path.join(__dirname, '../data/faq.json');
const CATEGORIES_PATH = path.join(__dirname, '../data/categories.json');
const KNOWLEDGE_BASES_PATH = path.join(__dirname, '../data/knowledge_bases.json');
const UPLOAD_DIR = path.join(__dirname, '../data/uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ============ 核心AI模块（智能意图理解、多轮对话记忆、LLM智能改写答案）============
const { understandIntent, batchUnderstandIntents, fallbackIntent, INTENT_TAXONOMY } = require('./intent-understanding');
const { storeConversationRound, getConversationHistory, enhanceQueryWithMemory, getMemoryStats, clearConversationHistory } = require('./dialogue-memory');
const { rewriteToColloquial, batchRewrite, evaluateQuality, getToneList } = require('./answer-rewriter');

// ============ 知识库管理（动态加载） ============
function loadKnowledgeBases() {
  if (!fs.existsSync(KNOWLEDGE_BASES_PATH)) {
    const defaultKB = [{ id: 'kb_default', name: '广康集团知识库', description: '默认知识库', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isDefault: true, isActive: true }];
    saveKnowledgeBases(defaultKB);
    return defaultKB;
  }
  try { return JSON.parse(fs.readFileSync(KNOWLEDGE_BASES_PATH, 'utf8')); } catch (e) { return []; }
}
function saveKnowledgeBases(data) { fs.writeFileSync(KNOWLEDGE_BASES_PATH, JSON.stringify(data, null, 2)); }
let KNOWLEDGE_BASES_CACHE = loadKnowledgeBases();
function getKnowledgeBases() { KNOWLEDGE_BASES_CACHE = loadKnowledgeBases(); return KNOWLEDGE_BASES_CACHE; }

// ============ 分类管理（支持二级分类） ============
function loadCategories() {
  if (!fs.existsSync(CATEGORIES_PATH)) {
    const defaultCats = [
      { id: 'cat_default', name: '常见问题', description: '默认分类', parentId: null, sortOrder: 0, isDefault: true, knowledgeBaseId: 'kb_default' },
      { id: 'cat_after_sale', name: '售后服务', description: '退货退款等售后问题', parentId: null, sortOrder: 1, isDefault: false, knowledgeBaseId: 'kb_default' },
      { id: 'cat_shipping', name: '配送物流', description: '配送、物流、快递相关问题', parentId: null, sortOrder: 2, isDefault: false, knowledgeBaseId: 'kb_default' },
      { id: 'cat_payment', name: '支付相关', description: '支付、付款、发票相关问题', parentId: null, sortOrder: 3, isDefault: false, knowledgeBaseId: 'kb_default' }
    ];
    saveCategories(defaultCats);
    return defaultCats;
  }
  try { return JSON.parse(fs.readFileSync(CATEGORIES_PATH, 'utf8')); } catch (e) { return []; }
}
function saveCategories(data) { fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(data, null, 2)); }

// ============ 基础信息：组织架构 ============
const ORG_PATH = path.join(__dirname, '../data/org_structure.json');
function loadOrg() {
  if (!fs.existsSync(ORG_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(ORG_PATH, 'utf8')); } catch (e) { return []; }
}
function saveOrg(data) { fs.writeFileSync(ORG_PATH, JSON.stringify(data, null, 2)); }

// ============ 基础信息：人员信息 ============
const PERSONNEL_PATH = path.join(__dirname, '../data/personnel.json');
function loadPersonnel() {
  if (!fs.existsSync(PERSONNEL_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(PERSONNEL_PATH, 'utf8')); } catch (e) { return []; }
}
function savePersonnel(data) { fs.writeFileSync(PERSONNEL_PATH, JSON.stringify(data, null, 2)); }

// ============ 基础信息：权限管理 ============
const PERMISSIONS_PATH = path.join(__dirname, '../data/permissions.json');
function loadPermissions() {
  if (!fs.existsSync(PERMISSIONS_PATH)) {
    // 种子数据：管理员 + 普通用户
    const seed = [
      {
        id: 'perm_001',
        roleName: '管理员',
        roleKey: 'admin',
        categoryId: null,
        categoryName: '全部',
        permissions: ['faq:read','faq:write','faq:delete','category:manage','personnel:manage','org:manage','permission:manage','a8:config'],
        isSystem: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'perm_003',
        roleName: '普通用户',
        roleKey: 'user',
        categoryId: null,
        categoryName: '全部',
        permissions: ['chat:access'],
        isSystem: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    savePermissions(seed);
    return seed;
  }
  try { return JSON.parse(fs.readFileSync(PERMISSIONS_PATH, 'utf8')); } catch (e) { return []; }
}
function savePermissions(data) { fs.writeFileSync(PERMISSIONS_PATH, JSON.stringify(data, null, 2)); }

// ============ 基础信息：A8配置 ============
const A8_CONFIG_PATH = path.join(__dirname, '../data/a8_config.json');
function loadA8Config() {
  if (!fs.existsSync(A8_CONFIG_PATH)) {
    const defaultConfig = { enabled: false, orgApiUrl: '', personnelApiUrl: '', syncInterval: 3600, lastSyncTime: null, auth: { type: 'basic', username: '', password: '' } };
    saveA8Config(defaultConfig);
    return defaultConfig;
  }
  try { return JSON.parse(fs.readFileSync(A8_CONFIG_PATH, 'utf8')); } catch (e) { return { enabled: false }; }
}
function saveA8Config(data) { fs.writeFileSync(A8_CONFIG_PATH, JSON.stringify(data, null, 2)); }

// ============ 数据存储（JSON 文件） ============
const DB_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function readDB() {
  const fp = DB_PATH.replace('.db', '.json');
  if (!fs.existsSync(fp)) return { conversations: [], faq_logs: [], satisfaction_stats: [] };
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function writeDB(data) {
  const fp = DB_PATH.replace('.db', '.json');
  fs.writeFileSync(fp, JSON.stringify(data, null, 2));
}

// ============ FAQ 知识库（动态加载） ============
function loadFAQ() {
  if (!fs.existsSync(FAQ_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8'));
  } catch (e) {
    console.error('FAQ 文件读取失败：', e.message);
    return [];
  }
}

function saveFAQ(data) {
  fs.writeFileSync(FAQ_PATH, JSON.stringify(data, null, 2));
}

// 兼容旧代码：导出 getter
let FAQ_KNOWLEDGE_BASE = loadFAQ();

// 每次读取 FAQ 时重新加载（支持热更新）
function getFAQ() {
  FAQ_KNOWLEDGE_BASE = loadFAQ();
  return FAQ_KNOWLEDGE_BASE;
}

// ============ 分类管理（动态加载） ============
// ============ 分类管理 API（支持二级分类） ============

// 兼容旧 FAQ 数据：为没有 category 字段的条目补充默认值
function normalizeFAQCategories() {
  const faqList = loadFAQ();
  let changed = false;
  for (const f of faqList) {
    if (!f.category) { f.category = '常见问题'; changed = true; }
  }
  if (changed) saveFAQ(faqList);
}

// 初始化时执行一次
setTimeout(() => { try { normalizeFAQCategories(); } catch(e) {} }, 1000);

// ============ 文件上传配置 ============
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.md', '.pdf', '.docx', '.doc', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('仅支持 .txt / .md / .pdf / .doc / .docx / .xls / .xlsx 格式'));
  }
});

// ============ 意图识别 ============
function detectIntent(userMessage) {
  const msg = userMessage.toLowerCase();
  
  // 仅做意图分类，不做FAQ关键词匹配（FAQ匹配由 searchFAQCandidates 通过RAG完成）
  const intentPatterns = [
    { pattern: ['退货', '退款', '退回'], intent: 'return_refund' },
    { pattern: ['配送', '发货', '快递', '物流'], intent: 'shipping' },
    { pattern: ['支付', '付款', '微信', '支付宝'], intent: 'payment' },
    { pattern: ['质量', '损坏', '坏了'], intent: 'quality_issue' },
    { pattern: ['账号', '登录', '密码'], intent: 'account_issue' },
    { pattern: ['优惠', '折扣', '券'], intent: 'coupon_usage' },
    { pattern: ['感谢', '谢谢', '满意'], intent: 'gratitude' },
    { pattern: ['投诉', '不满', '差评', '垃圾'], intent: 'complaint' }
  ];
  
  for (const { pattern, intent } of intentPatterns) {
    for (const p of pattern) {
      if (msg.includes(p)) {
        return { matchedFAQ: null, confidence: 0.7, intent };
      }
    }
  }
  
  return { matchedFAQ: null, confidence: 0.3, intent: 'custom' };
}

// ============ 模糊匹配（相似度计算） ============
function getBigrams(s) {
  const normalized = s.toLowerCase().replace(/[\s\.,;:!?，。；：！？、""''()（）]/g, '');
  const bigrams = new Set();
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  if (bigrams.size === 0 && normalized.length > 0) {
    bigrams.add(normalized);
  }
  return bigrams;
}

function calculateSimilarity(s1, s2) {
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;
  for (const b of b1) {
    if (b2.has(b)) intersection++;
  }
  const union = b1.size + b2.size - intersection;
  return union > 0 ? intersection / union : (b1.size === 0 && b2.size === 0 ? 1 : 0);
}

function getFAQByCategory(category) {
  const list = getFAQ();
  if (!category || category === '全部' || category === 'all') return list;
  return list.filter(f => f.category === category);
}

// ============ 同义词规范化（本地快速匹配用） ============
const SYNONYM_MAP = {
  '一级': '一类', '二级': '二类', '三级': '三类', '四级': '四类', '五级': '五类',
  '1级': '一类', '2级': '二类', '3级': '三类',
  '一级城市': '一类城市', '二级城市': '二类城市', '三级城市': '三类城市',
};

function normalizeQuery(text) {
  let normalized = text.toLowerCase().replace(/[？?。，,、；;：:！!（）()\s]/g, '');
  for (const [from, to] of Object.entries(SYNONYM_MAP)) {
    normalized = normalized.replace(new RegExp(from, 'g'), to);
  }
  return normalized;
}

/**
 * 快速本地关键词匹配（不调用Ollama，<10ms）
 * 处理同义词、关键词重叠、包含关系等
 */
function quickLocalMatch(query, faqList) {
  const normalizedQuery = normalizeQuery(query);
  const results = [];

  for (const faq of faqList) {
    let score = 0;
    const normalizedQuestion = normalizeQuery(faq.question);

    // 1. 完全匹配（含同义词替换后）
    if (normalizedQuestion === normalizedQuery) {
      score = 0.98;
    }
    // 2. 包含关系
    else if (normalizedQuestion.includes(normalizedQuery)) {
      score = 0.90;
    }
    else if (normalizedQuery.includes(normalizedQuestion)) {
      score = 0.88;
    }
    // 3. 关键词匹配
    else {
      if (faq.keywords && Array.isArray(faq.keywords)) {
        const normalizedKeywords = faq.keywords.map(k => normalizeQuery(k));
        for (const kw of normalizedKeywords) {
          if (normalizedQuery.includes(kw)) score += 0.25;
          if (kw.includes(normalizedQuery)) score += 0.20;
        }
      }
      // 问题文本中的词匹配
      const qWords = normalizedQuestion.split(/[的之是和与及或]/).filter(w => w.length >= 2);
      for (const w of qWords) {
        if (normalizedQuery.includes(w)) score += 0.08;
      }
    }

    if (score >= 0.35) {
      results.push({ faq, score: Math.min(score, 0.98) });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function searchFAQCandidates(userMessage, threshold = 0.12, category = null) {
  const faqList = getFAQByCategory(category);
  const candidates = [];

  // ===== 超快速路径：本地关键词匹配（不调用Ollama，<10ms） =====
  const startLocal = Date.now();
  const localMatches = quickLocalMatch(userMessage, faqList);
  if (localMatches.length > 0) {
    const cost = Date.now() - startLocal;
    console.log(`[searchFAQCandidates] 本地快速匹配命中: ${localMatches.length}条, 耗时:${cost}ms`);
    for (const m of localMatches) {
      candidates.push({
        faq: m.faq,
        confidence: m.score,
        intent: m.faq.intent,
        fromRAG: false,
        ragScore: m.score
      });
    }
    return candidates.slice(0, 5);
  }

  // 快速路径：使用 FAQ embedding 缓存（纯内存计算，无需调用 Rerank）
  if (userMessage.length >= 4) {
    try {
      const start = Date.now();
      const searchResults = await searchByFAQCacheAsync(userMessage, 5, 0.10);
      const cost = Date.now() - start;
      console.log(`[searchFAQCandidates] FAQ缓存搜索耗时: ${cost}ms, 结果: ${searchResults.length}条`);

      for (const r of searchResults) {
        const faqId = r.parentDocId;
        if (!faqId) continue;
        const faq = faqList.find(f => f.id === faqId);
        if (!faq) continue;
        if (candidates.some(c => c.faq.id === faq.id)) continue;

        // 直接使用余弦相似度作为置信度（更稳定，不受 Rerank 波动影响）
        let confidence = r.score;

        // 置信度上限
        if (confidence > 0.90) confidence = 0.90;
        // 置信度下限
        if (confidence < 0.25) continue;

        candidates.push({
          faq,
          confidence: confidence,
          intent: faq.intent,
          fromRAG: true,
          ragScore: r.score
        });
      }
    } catch (e) {
      console.error('[RAG] FAQ缓存搜索失败，降级到 semanticSearch:', e.message);
      // Fallback: 使用原来的 semanticSearch
      try {
        const searchResults = await semanticSearch(userMessage, 5, 0.10, true);
        for (const r of searchResults) {
          const faqId = r.parentDocId;
          if (!faqId) continue;
          const faq = faqList.find(f => f.id === faqId);
          if (!faq) continue;
          if (candidates.some(c => c.faq.id === faq.id)) continue;
          const finalScore = (r.rerankScore !== undefined ? r.rerankScore : r.score);
          let confidence = finalScore;
          if (confidence > 0.85) confidence = 0.85;
          if (confidence < 0.3) continue;
          candidates.push({ faq, confidence, intent: faq.intent, fromRAG: true, ragScore: finalScore });
        }
      } catch (e2) {
        console.error('[RAG] Fallback搜索也失败:', e2.message);
      }
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, 5);
}

// ============ 调用 Ollama 生成回复（RAG 增强） ============
async function generateAgentReply(sessionId, userMessage, conversationHistory, intentResult) {
  // FAQ 精确匹配优先
  if (intentResult.matchedFAQ) {
    return intentResult.matchedFAQ.answer;
  }
  
  // RAG 语义搜索：获取相关文档片段（使用 FAQ 缓存，避免重复调用 Ollama）
  let ragContext = '';
  try {
    const searchResults = await searchByFAQCacheAsync(userMessage, 3, 0.12);
    if (searchResults && searchResults.length > 0) {
      ragContext = '\n\n===== 相关资料（语义搜索结果）=====\n';
      // 通过 parentDocId 找到完整 FAQ 内容
      const faqList = getFAQ();
      searchResults.forEach((r, i) => {
        const faq = faqList.find(f => f.id === r.parentDocId);
        const content = faq ? `Q: ${faq.question}\nA: ${faq.answer}` : r.content;
        ragContext += `\n[资料${i+1}]（相关度：${(r.score * 100).toFixed(1)}%）\n${content.slice(0, 800)}\n`;
      });
      ragContext += '\n===== 请基于以上资料回答 =====\n';
      console.log(`[RAG] 注入 ${searchResults.length} 条相关文档，top score=${(searchResults[0].score * 100).toFixed(1)}%`);
    }
  } catch (e) {
    console.error('[RAG] 语义搜索失败，降级到普通模式：', e.message);
  }
  
  // 构建 prompt
  const faqContext = getFAQ().map(f => `Q: ${f.question}\nA: ${f.answer}`).join('\n\n');
  
  const systemPrompt = `你是「广康集团AI助手」的智能客服，名字叫「小智」。
请用简洁、友好、专业的中文回答用户问题。

规则：
1. 优先基于【相关资料】回答，不要编造信息
2. 资料中没有的内容，可参考 FAQ 知识库回答
3. 回答控制在 2-3 句话内，简洁明了
4. 如无法回答，请礼貌告知用户
5. 语气亲切，用「您」称呼用户
6. 当前识别意图：${intentResult.intent}
${ragContext}
FAQ 知识库：
${faqContext}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory.slice(-6).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
    { role: 'user', content: userMessage }
  ];
  
  try {
    const reply = await callOllamaChat(messages, {
      baseURL: OLLAMA_BASE_URL,
      model: MODEL_NAME,
      temperature: 0.3,
      max_tokens: 500
    });
    return reply || '抱歉，我暂时无法回答您的问题，正在为您转接人工客服...';
  } catch (err) {
    console.error('生成回复失败：', err);
    return '抱歉，系统暂时繁忙，正在为您转接人工客服，请稍候...';
  }
}

// ============ Express + WebSocket 服务 ============
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// 静态文件服务：uploads 目录（图片/附件）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// 上传专用：支持图片和附件
const uploadMedia = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.pdf', '.docx', '.doc', '.xlsx', '.xls', '.txt', '.md'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error('仅支持图片（jpg/png/gif/webp）和文档（pdf/docx/xlsx/txt/md）'));
  }
});

// 管理后台 API
app.get('/api/admin/stats', (req, res) => {
  try {
    const db = readDB();
    const total = db.conversations.length;
    const resolved = db.conversations.filter(c => c.resolved).length;
    const rated = db.satisfaction_stats.filter(s => s.rating);
    const avg = rated.length > 0 ? rated.reduce((a, b) => a + b.rating, 0) / rated.length : 0;
    
    res.json({
      totalConversations: total,
      resolvedCount: resolved,
      avgSatisfaction: Math.round(avg * 10) / 10,
      recentConversations: db.conversations.slice(-20).reverse()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



// ============ RAG 管理统一路由（整合意图理解、答案改写、FAQ、知识库）============
// 说明：以下路由已迁移到 rag-admin.js，通过统一 Router 管理
// 路径保持不变（/api/admin/*），前端无需修改
const ragAdminRouter = require('./rag-admin');
app.use('/api/admin', ragAdminRouter);
// ============ 以下为已迁移到 rag-admin.js 的旧路由定义（已注释，保留以备回滚）============
/*
  try {
    const { query, context = {} } = req.body;
    if (!query || !query.trim()) return res.status(400).json({ error: 'query 不能为空' });
    console.log('[API] Received query:', JSON.stringify(query));
    const result = await understandIntent(query.trim(), context);
    console.log('[API] understandIntent result:', JSON.stringify(result));
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Intent API] 解析失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 批量问题意图解析
app.post('/api/admin/intent-batch', async (req, res) => {
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
app.get('/api/admin/intent-taxonomy', (req, res) => {
  try {
    const taxonomy = INTENT_TAXONOMY;
    res.json({ success: true, taxonomy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
*/
// ============ 多轮对话记忆 API ============
// 存储对话轮次
app.post('/api/chat/store', (req, res) => {
  try {
    const { sessionId, userQuery, aiResponse, intent, entities } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId 不能为空' });
    const result = storeConversationRound(sessionId, {
      userQuery: userQuery || '',
      aiResponse: aiResponse || '',
      intent: intent || null,
      entities: entities || [],
      timestamp: Date.now()
    });
    res.json({ success: true, roundId: result.roundId, totalRounds: result.totalRounds });
  } catch (err) {
    console.error('[Memory API] 存储失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取对话历史
app.post('/api/chat/history', (req, res) => {
  try {
    const { sessionId, limit = 10, includeContext = false } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId 不能为空' });
    const history = getConversationHistory(sessionId, limit, includeContext);
    res.json({ success: true, history, total: history.length });
  } catch (err) {
    console.error('[Memory API] 获取历史失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 增强查询（指代消解 + 上下文补全）
app.post('/api/chat/enhance', async (req, res) => {
  try {
    const { query, sessionId } = req.body;
    if (!query || !sessionId) return res.status(400).json({ error: 'query 和 sessionId 必填' });
    const enhanced = await enhanceQueryWithMemory(query, sessionId);
    res.json({ success: true, original: query, enhanced });
  } catch (err) {
    console.error('[Memory API] 增强查询失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取记忆统计
app.get('/api/chat/memory-stats', (req, res) => {
  try {
    const stats = getMemoryStats();
    res.json({ success: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清空会话历史
app.post('/api/chat/clear', (req, res) => {
  try {
    const { sessionId } = req.body;
    clearConversationHistory(sessionId || null);
    res.json({ success: true, message: sessionId ? '会话已清空' : '所有会话已清空' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ LLM 智能改写答案 API（已迁移到 rag-admin.js）============
/*
// 测试改写单个答案
app.post('/api/admin/rewrite-test', async (req, res) => {
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
app.post('/api/admin/rewrite-batch', async (req, res) => {
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
app.get('/api/admin/rewrite-tones', (req, res) => {
  try {
    const tones = getToneList();
    res.json({ success: true, tones });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 评估改写质量
app.post('/api/admin/rewrite-evaluate', (req, res) => {
  try {
    const { original, rewritten } = req.body;
    if (!original || !rewritten) return res.status(400).json({ error: 'original 和 rewritten 必填' });
    const evaluation = evaluateQuality(original, rewritten);
    res.json({ success: true, evaluation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
*/

// ============ 知识库管理 API（已迁移到 rag-admin.js）============
/*
app.get('/api/admin/knowledge-bases', (req, res) => {
  try {
    res.json(getKnowledgeBases().filter(k => k.isActive));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增知识库
app.post('/api/admin/knowledge-bases', (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '知识库名称必填' });
    const list = getKnowledgeBases();
    if (list.some(k => k.name === name.trim())) return res.status(400).json({ error: '知识库名称已存在' });
    const id = 'kb_' + Date.now();
    list.push({ id, name: name.trim(), description: description || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isDefault: false, isActive: true });
    saveKnowledgeBases(list);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改知识库
app.put('/api/admin/knowledge-bases/:id', (req, res) => {
  try {
    const list = getKnowledgeBases();
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

// 删除知识库（将该库下分类和 FAQ 改为默认知识库）
app.delete('/api/admin/knowledge-bases/:id', (req, res) => {
  try {
    const list = getKnowledgeBases();
    const target = list.find(k => k.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.isDefault) return res.status(400).json({ error: '默认知识库不可删除' });
    // 将该库下分类的 knowledgeBaseId 改为默认库
    const catList = loadCategories();
    catList.forEach(c => { if (c.knowledgeBaseId === target.id) c.knowledgeBaseId = 'kb_default'; });
    saveCategories(catList);
    // 将该库下 FAQ 的 category 改为「常见问题」
    const faqList = getFAQ();
    // 找到该库下的分类名称
    const catNames = catList.filter(c => c.knowledgeBaseId === target.id).map(c => c.name);
    faqList.forEach(f => { if (catNames.includes(f.category)) f.category = '常见问题'; });
    saveFAQ(faqList);
    // 标记删除（不真正删除，设为 inactive）
    list.find(k => k.id === req.params.id).isActive = false;
    saveKnowledgeBases(list);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
*/ // 知识库管理API注释结束

// ============ 分类管理 API（支持二级分类）（已迁移到 rag-admin.js）============
/*
// 获取分类列表（支持按 knowledgeBaseId 过滤）
app.get('/api/admin/categories', (req, res) => {
  try {
    const { knowledgeBaseId } = req.query;
    let list = loadCategories();
    if (knowledgeBaseId) list = list.filter(c => c.knowledgeBaseId === knowledgeBaseId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 前端接口：获取一级分类（parentId 为 null）
app.get('/api/categories', (req, res) => {
  try {
    const { knowledgeBaseId } = req.query;
    let list = loadCategories();
    // 只返回一级分类
    list = list.filter(c => c.parentId === null);
    if (knowledgeBaseId) list = list.filter(c => c.knowledgeBaseId === knowledgeBaseId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增分类
app.post('/api/admin/categories', (req, res) => {
  try {
    const { name, description, parentId, knowledgeBaseId } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: '分类名称必填' });
    const list = loadCategories();
    if (list.some(c => c.name === name.trim())) return res.status(400).json({ error: '分类名称已存在' });
    const id = 'cat_' + Date.now();
    list.push({
      id,
      name: name.trim(),
      description: description || '',
      parentId: parentId || null,
      knowledgeBaseId: knowledgeBaseId || '',
      sortOrder: list.length,
      isDefault: false
    });
    saveCategories(list);
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改分类
app.put('/api/admin/categories/:id', (req, res) => {
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

// 删除分类（将该分类下 FAQ 改为「常见问题」）
app.delete('/api/admin/categories/:id', (req, res) => {
  try {
    const list = loadCategories();
    const target = list.find(c => c.id === req.params.id);
    if (!target) return res.status(404).json({ error: 'Not found' });
    if (target.isDefault) return res.status(400).json({ error: '默认分类不可删除' });
    // 将该分类下的 FAQ 改到默认分类
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

// FAQ - 列表（支持按 category 过滤）
app.get('/api/admin/faq', (req, res) => {
  try {
    const { category } = req.query;
    let list = getFAQ();
    if (category && category !== '全部' && category !== 'all') {
      list = list.filter(f => f.category === category);
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FAQ - 新增（同步向量化）
app.post('/api/admin/faq', async (req, res) => {
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
    // 异步向量化
    addDocumentChunks(id, question, `问题：${question}\n答案：${answer}`, { category: item.category, source: 'faq' })
      .then(() => console.log('[RAG] 新增FAQ向量化完成:', question.slice(0,30)))
      .catch(e => console.error('[RAG] 新增FAQ向量化失败:', e.message));
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FAQ - 修改（同步更新向量）
app.put('/api/admin/faq/:id', async (req, res) => {
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
    // 异步重建该FAQ向量
    const f = list[idx];
    addDocumentChunks(f.id, f.question, `问题：${f.question}\n答案：${f.answer}`, { category: f.category, source: 'faq' })
      .then(() => console.log('[RAG] FAQ更新向量化完成:', f.question.slice(0,30)))
      .catch(e => console.error('[RAG] FAQ更新向量化失败:', e.message));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FAQ - 批量删除
app.post('/api/admin/faq/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids 必须是非空数组' });
    const list = getFAQ();
    const before = list.length;
    const newList = list.filter(f => !ids.includes(f.id));
    if (newList.length === before) return res.status(404).json({ error: '未找到要删除的条目' });
    saveFAQ(newList);
    // 批量删除向量
    const { deleteDocument } = require('./vector-store');
    ids.forEach(id => deleteDocument(id));
    res.json({ success: true, deleted: before - newList.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FAQ - 删除（同步删除向量）
app.delete('/api/admin/faq/:id', (req, res) => {
  try {
    const list = getFAQ();
    const newList = list.filter(f => f.id !== req.params.id);
    if (newList.length === list.length) return res.status(404).json({ error: 'Not found' });
    saveFAQ(newList);
    const { deleteDocument } = require('./vector-store');
    deleteDocument(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// FAQ - 文件上传 + 自动提取（同步向量化）
app.post('/api/admin/faq/upload', upload.single('file'), async (req, res) => {
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

    const uploadCategory = (req.body.category && req.body.category.trim()) ? req.body.category.trim()
                        : (req.query.category && req.query.category.trim()) ? req.query.category.trim()
                        : null;
    console.log('[UPLOAD] 最终分类 =', uploadCategory);
    const extracted = extractFAQFromText(text, uploadCategory);
    const list = getFAQ();
    let added = 0;
    for (const item of extracted) {
      const id = 'faq_' + Date.now() + '_' + added;
      list.push({ id, ...item, intent: item.intent || 'custom' });
      // 异步向量化每个FAQ
      const content = `问题：${item.question}\n答案：${item.answer}`;
      addDocumentChunks(id, item.question, content, { category: item.category, source: 'faq_upload' })
        .then(() => console.log('[RAG] 上传文档FAQ向量化完成:', item.question.slice(0,30)))
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

// ============ 图片/附件上传 API（供 FAQ 答案插入图片/链接使用） ============
app.post('/api/admin/upload-media', uploadMedia.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未收到文件' });
    const file = req.file;
    // 前端传来的 originalName 是 UTF-8 编码的正确中文名，优先使用
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
      markdown: isImage ? `![${originalName}](${url})` : `[📁 ${originalName}](${url})`
    });
  } catch (err) {
    console.error('[媒体上传] 失败：', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ 向量库管理 API ============
// 获取向量库统计
app.get('/api/admin/vector-stats', (req, res) => {
  try {
    res.json(getVectorStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重建向量库（从现有FAQ重新向量化）
app.post('/api/admin/vector-rebuild', async (req, res) => {
  try {
    res.json({ success: true, message: '向量库重建中，请稍候...' });
    // 异步执行，不阻塞响应
    rebuildVectorStore()
      .then(r => console.log('[RAG] 向量库重建完成，共', r.count, '个文档'))
      .catch(e => console.error('[RAG] 向量库重建失败：', e.message));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 上传文件列表 ============
app.get('/api/admin/uploads', (req, res) => {
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

// ============ 删除上传文件 ============
app.delete('/api/admin/uploads/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const fp = path.join(__dirname, 'uploads', filename);
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 基础信息：组织架构管理 ============
app.get('/api/admin/org', (req, res) => {
  try { res.json(loadOrg()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/org', (req, res) => {
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
    res.json({ success: true, data: newOrg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/org/:id', (req, res) => {
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

app.delete('/api/admin/org/:id', (req, res) => {
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
app.get('/api/admin/personnel', (req, res) => {
  try {
    const list = loadPersonnel();
    const { orgId } = req.query;
    const filtered = orgId ? list.filter(p => p.orgId === orgId) : list;
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/personnel', (req, res) => {
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

app.put('/api/admin/personnel/:id', (req, res) => {
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

app.delete('/api/admin/personnel/:id', (req, res) => {
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
app.get('/api/admin/permissions', (req, res) => {
  try { res.json(loadPermissions()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/admin/permissions', (req, res) => {
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

app.put('/api/admin/permissions/:id', (req, res) => {
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

app.delete('/api/admin/permissions/:id', (req, res) => {
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
app.get('/api/admin/a8-config', (req, res) => {
  try { res.json(loadA8Config()); } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/admin/a8-config', (req, res) => {
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

app.post('/api/admin/a8-test', async (req, res) => {
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

app.post('/api/admin/a8-sync', async (req, res) => {
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
*/ // 分类管理、FAQ管理、上传管理、向量管理等API已迁移到 rag-admin.js

// 从文本自动提取 FAQ，uploadCategory 为上传时选择的分类（优先级最高）
function extractFAQFromText(text, uploadCategory = null) {
  const results = [];
  const content = text.replace(/\r\n/g, '\n').trim();
  
  // 策略1: 匹配 Q:/问： A:/答： 格式（支持中英文标点和空格变体）
  const qaRegex = /(?:Q[:：\s]|问\s*[:：]\s*)\s*(.+?)\s*(?:A[:：\s]|答\s*[:：]\s*)\s*([\s\S]*?)(?=\n\s*(?:Q[:：]|问\s*[:：])|$)/gi;
  let match;
  let qaCount = 0;
  while ((match = qaRegex.exec(content)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim().replace(/\n+/g, ' ').slice(0, 500);
    if (question && answer && question.length > 2 && answer.length > 2) {
      const keywords = question.replace(/[？?。.，,、；;：:！!（）()\s]/g, '|').split('|').filter(w => w.length >= 2);
      const category = uploadCategory || '自动提取';
      results.push({ question, answer, keywords: [...new Set(keywords)], intent: 'custom', category });
      qaCount++;
    }
  }
  if (qaCount > 0) { console.log(`[提取] 策略1提取了 ${qaCount} 条QA格式`); return results; }
  
  // 策略2: 匹配 "问题：/答案："、"标题：/内容：" 等格式
  const qaRegex2 = /(?:问题|标题|主题)\s*[:：]\s*(.+?)[\s\S]*?(?:答案|内容|回复|解答)\s*[:：]\s*([\s\S]*?)(?=\n\s*(?:问题|标题|主题)\s*[:：]|$)/gi;
  while ((match = qaRegex2.exec(content)) !== null) {
    const question = match[1].trim();
    const answer = match[2].trim().replace(/\n+/g, ' ').slice(0, 500);
    if (question && answer && question.length > 2 && answer.length > 2) {
      const keywords = question.replace(/[？?。.，,、；;：:！!（）()\s]/g, '|').split('|').filter(w => w.length >= 2);
      const category = uploadCategory || '自动提取';
      results.push({ question, answer, keywords: [...new Set(keywords)], intent: 'custom', category });
      qaCount++;
    }
  }
  if (qaCount > 0) { console.log(`[提取] 策略2提取了 ${qaCount} 条问题/答案格式`); return results; }
  
  // 策略3: 按段落分割，每段尝试拆成 QA
  console.log('[提取] 未匹配到QA格式，使用段落分割策略');
  const paragraphs = content.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 10);
  console.log(`[提取] 共 ${paragraphs.length} 个段落`);
  
  for (const para of paragraphs.slice(0, 50)) {  // 最多处理50段
    // 尝试按句子分割：第一句作为问题，其余作为答案
    // 修复：避免使用正向后行断言（某些Node.js版本不支持）
    const sentences = para.match(/[^。！？!?]+[。！？!?]?/g);
    if (!sentences) continue;
    if (sentences.length >= 2) {
      // 如果段落有多个句子，第一句作为问题（加问号），其余作为答案
      let question = sentences[0];
      if (!question.match(/[？?]$/)) question += '？';
      const answer = sentences.slice(1).join('。');
      if (question.length > 3 && answer.length > 5) {
        const keywords = question.replace(/[？?。.，,、；;：:！!（）()\s]/g, '|').split('|').filter(w => w.length >= 2);
        const category = uploadCategory || '自动提取';
        results.push({ question, answer, keywords: [...new Set(keywords)], intent: 'custom', category });
      }
    } else if (sentences.length === 1 && para.length > 10) {
      // 只有一句话，尝试从标点和关键词判断是否是问答
      const splitIdx = para.search(/[：:]/);
      if (splitIdx > 0 && splitIdx < para.length - 2) {
        const question = para.slice(0, splitIdx).trim() + '？';
        const answer = para.slice(splitIdx + 1).trim();
        if (question.length > 2 && answer.length > 2) {
          const keywords = question.replace(/[？?。.，,、；;：:！!（）()\s]/g, '|').split('|').filter(w => w.length >= 2);
          const category = uploadCategory || '自动提取';
          results.push({ question, answer, keywords: [...new Set(keywords)], intent: 'custom', category });
        }
      }
    }
  }
  
  // 策略4: 如果还是没有结果，整段作为答案，用前20字作为问题
  if (results.length === 0) {
    console.log('[提取] 策略3未提取到，使用整段提取');
    for (const para of paragraphs.slice(0, 30)) {
      if (para.length > 20) {
        const question = para.slice(0, 20).trim() + '？';
        const answer = para.trim();
        const keywords = question.replace(/[？?。.，,、；;：:！!（）()\s]/g, '|').split('|').filter(w => w.length >= 2);
        const category = uploadCategory || '自动提取';
        results.push({ question, answer, keywords: [...new Set(keywords)], intent: 'custom', category });
      }
    }
  }
  
  console.log(`[提取] 共提取 ${results.length} 条`);
  return results;
}

// ============ 对话记录 API ============
app.get('/api/admin/conversations', (req, res) => {
  try {
    const db = readDB();
    const { limit = 100, offset = 0 } = req.query;
    const slice = db.conversations.slice(Number(offset), Number(offset) + Number(limit));
    res.json(slice.map(c => ({ ...c, messages: JSON.parse(c.messages) })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/conversations/:sessionId', (req, res) => {
  try {
    const db = readDB();
    const conv = db.conversations.find(c => c.session_id === req.params.sessionId);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    res.json({ ...conv, messages: JSON.parse(conv.messages) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 对话记录 - 单个删除
app.delete('/api/admin/conversations/:sessionId', (req, res) => {
  try {
    const db = readDB();
    const before = db.conversations.length;
    db.conversations = db.conversations.filter(c => c.session_id !== req.params.sessionId);
    if (db.conversations.length === before) return res.status(404).json({ error: 'Not found' });
    writeDB(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 对话记录 - 批量删除
app.post('/api/admin/conversations/batch-delete', (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids 必须是非空数组' });
    const db = readDB();
    const before = db.conversations.length;
    db.conversations = db.conversations.filter(c => !ids.includes(c.session_id));
    const deleted = before - db.conversations.length;
    if (deleted === 0) return res.status(404).json({ error: '未找到要删除的记录' });
    writeDB(db);
    res.json({ success: true, deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/satisfaction', (req, res) => {
  try {
    const { sessionId, rating, comment } = req.body;
    const db = readDB();
    const id = uuidv4();
    db.satisfaction_stats.push({ id, session_id: sessionId, rating, comment: comment || '', created_at: new Date().toISOString() });
    
    const conv = db.conversations.find(c => c.session_id === sessionId);
    if (conv) { conv.satisfaction = rating; conv.resolved = true; conv.updated_at = new Date().toISOString(); }
    
    writeDB(db);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ WebSocket 服务 ============
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const sessions = new Map();

function getOrCreateConversation(sessionId) {
  const db = readDB();
  let conv = db.conversations.find(c => c.session_id === sessionId);
  if (conv) return conv;
  
  const id = uuidv4();
  const now = new Date().toISOString();
  conv = { id, session_id: sessionId, messages: JSON.stringify([]), intent: null, resolved: false, satisfaction: null, created_at: now, updated_at: now };
  db.conversations.push(conv);
  writeDB(db);
  return { ...conv, messages: [] };
}

function saveMessage(sessionId, role, content, intent = null) {
  const db = readDB();
  let convIdx = db.conversations.findIndex(c => c.session_id === sessionId);
  if (convIdx === -1) {
    // session 不存在，自动创建
    const conv = getOrCreateConversation(sessionId);
    const db2 = readDB(); // 重新读取（getOrCreateConversation 已写入）
    convIdx = db2.conversations.findIndex(c => c.session_id === sessionId);
    if (convIdx === -1) return;
    // 用新读取的 db 继续
    const conv2 = db2.conversations[convIdx];
    const messages = JSON.parse(conv2.messages);
    messages.push({ role, content, timestamp: new Date().toISOString() });
    conv2.messages = JSON.stringify(messages);
    conv2.updated_at = new Date().toISOString();
    if (intent) conv2.intent = intent;
    db2.conversations[convIdx] = conv2;
    writeDB(db2);
    return;
  }
  
  const conv = db.conversations[convIdx];
  const messages = JSON.parse(conv.messages);
  messages.push({ role, content, timestamp: new Date().toISOString() });
  
  conv.messages = JSON.stringify(messages);
  conv.updated_at = new Date().toISOString();
  if (intent) conv.intent = intent;
  
  db.conversations[convIdx] = conv;
  writeDB(db);
}

wss.on('connection', (ws) => {
  let sessionId = null;
  
  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      
      if (msg.type === 'init') {
        sessionId = msg.sessionId || uuidv4();
        const category = msg.category || null; // 前端可选传入分类
        sessions.set(sessionId, { ws, history: [], category });
        ws.send(JSON.stringify({ type: 'init', sessionId }));
        
        const conv = getOrCreateConversation(sessionId);
        const messages = typeof conv.messages === 'string' ? JSON.parse(conv.messages) : conv.messages;
        if (messages.length > 0) {
          ws.send(JSON.stringify({ type: 'history', messages }));
        }
        return;
      }
      
      if (msg.type === 'message' && sessionId) {
        const userMessage = msg.content;
        const category = (() => { const s = sessions.get(sessionId); return s ? s.category : null; })();
        saveMessage(sessionId, 'user', userMessage);
        
        // 语义搜索候选 FAQ（本地快速匹配 → FAQ缓存搜索 → Rerank重排序）
        console.log(`[WS] 收到消息: "${userMessage}", 开始语义搜索...`);
        const candidates = await searchFAQCandidates(userMessage, 0.12, category);
        console.log(`[WS] 语义搜索完成, 候选问题数量: ${candidates.length}`);
        
        if (candidates.length > 0) {
          // 高置信度（≥0.6）：直接返回最佳答案，不等待用户点击，不调LLM
          if (candidates[0].confidence >= 0.6) {
            const best = candidates[0];
            const reply = best.faq.answer;
            saveMessage(sessionId, 'assistant', reply, best.intent);
            ws.send(JSON.stringify({
              type: 'message',
              content: reply,
              timestamp: new Date().toISOString(),
              intent: best.intent,
              confidence: best.confidence,
              fallback: false,
              matchedQuestion: best.faq.question
            }));
            console.log(`[WS] 高置信度直接返回: "${userMessage}" → "${best.faq.question}" (confidence: ${best.confidence.toFixed(2)})`);
            return;
          }

          // 低置信度：发送候选列表让用户选择
          ws.send(JSON.stringify({
            type: 'intent',
            intent: 'faq_candidate',
            confidence: candidates[0].confidence,
          }));

          const candidateList = candidates.map(c => ({
            id: c.faq.id,
            question: c.faq.question,
            answer: c.faq.answer,
            confidence: Math.round(c.confidence * 100) / 100
          }));

          ws.send(JSON.stringify({
            type: 'candidates',
            candidates: candidateList,
            originalMessage: userMessage
          }));
          return;
        }
        
        // 没有匹配，走原有逻辑（AI 生成或转人工）
        ws.send(JSON.stringify({
          type: 'intent',
          intent: intentResult.intent,
          confidence: intentResult.confidence,
          intent: intentResult.intent,
          confidence: intentResult.confidence,
        }));
        
        // 记录 FAQ 日志
        const db = readDB();
        db.faq_logs.push({
          id: uuidv4(), session_id: sessionId, question: userMessage,
          matched_question: intentResult.matchedFAQ?.question || null,
          intent: intentResult.intent, confidence: intentResult.confidence,
          transferred: 0, created_at: new Date().toISOString()
        });
        writeDB(db);
        
        if (intentResult.confidence < 0.4) {
          const reply = '正在为您转接人工客服，请稍候...我们的工作时间是 9:00-21:00，请您耐心等待。';
          saveMessage(sessionId, 'assistant', reply, intentResult.intent);
          ws.send(JSON.stringify({
            type: 'message', content: reply,
            timestamp: new Date().toISOString()
          }));
          return;
        }
        
        const conv = (() => {
          const db = readDB();
          const c = db.conversations.find(c => c.session_id === sessionId);
          return c ? { ...c, messages: JSON.parse(c.messages) } : null;
        })();
        const history = conv ? conv.messages : [];
        
        ws.send(JSON.stringify({ type: 'typing', status: true }));
        
        try {
          const reply = await generateAgentReply(sessionId, userMessage, history, intentResult);
          saveMessage(sessionId, 'assistant', reply, intentResult.intent);
          
          ws.send(JSON.stringify({
            type: 'message', content: reply,
            timestamp: new Date().toISOString(),
            intent: intentResult.intent, confidence: intentResult.confidence
          }));
        } catch (err) {
          console.error('生成回复失败：', err);
          const fallback = '抱歉，我暂时无法处理您的问题，正在为您转接人工客服...';
          saveMessage(sessionId, 'assistant', fallback, intentResult.intent);
          ws.send(JSON.stringify({ type: 'message', content: fallback, timestamp: new Date().toISOString(), fallback: true }));
        } finally {
          ws.send(JSON.stringify({ type: 'typing', status: false }));
        }
      }
      
      if (msg.type === 'candidate_select' && sessionId) {
        const { candidateId } = msg;
        const faqList = getFAQ();
        const faq = faqList.find(f => f.id === candidateId);
        if (faq) {
          saveMessage(sessionId, 'assistant', faq.answer, faq.intent);
          ws.send(JSON.stringify({
            type: 'message', content: faq.answer,
            timestamp: new Date().toISOString(),
            intent: faq.intent, confidence: 1.0, fallback: true
          }));
        }
        return;
      }
      
      if (msg.type === 'satisfaction') {
        const { rating, comment } = msg;
        const db = readDB();
        db.satisfaction_stats.push({
          id: uuidv4(), session_id: sessionId, rating, comment: comment || '',
          created_at: new Date().toISOString()
        });
        const convIdx = db.conversations.findIndex(c => c.session_id === sessionId);
        if (convIdx !== -1) {
          db.conversations[convIdx].satisfaction = rating;
          db.conversations[convIdx].resolved = true;
          db.conversations[convIdx].updated_at = new Date().toISOString();
        }
        writeDB(db);
        ws.send(JSON.stringify({ type: 'satisfaction_ack', success: true }));
      }
      
    } catch (err) {
      console.error('WebSocket 消息处理错误：', err);
      ws.send(JSON.stringify({ type: 'error', message: '消息处理失败' }));
    }
  });
  
  ws.on('close', () => {
    if (sessionId) sessions.delete(sessionId);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🤖 广康集团AI助手后端服务启动成功！`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   管理后台 API: http://localhost:${PORT}/api/admin/stats`);
  console.log(`   AI 模型: ${MODEL_NAME} @ ${OLLAMA_URL}`);
  console.log(`   数据文件: ${DB_PATH.replace('.db', '.json')}`);

  // 构建 FAQ embedding 缓存（加速搜索）
  try {
    const count = buildFAQEmbeddingCache();
    console.log(`   FAQ 缓存: ${count} 条（内存加速搜索）`);
  } catch (e) {
    console.warn(`   FAQ 缓存构建失败: ${e.message}`);
  }
});
