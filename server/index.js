require('dotenv').config();  // 加载.env环境变量配置

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const multer = require('multer');
const auth = require('./auth');  // 用户认证模块

// 导入模型自动切换管理器
const modelSwitcher = require('./model-switcher');

// 软件信息（可编辑品牌/名称/欢迎语等）
const { loadSoftwareInfo } = require('./data');

// ============ 环境配置 ============
// HyDE（假设文档生成）：默认关闭，因为会增加延迟
// 启用方法：启动时设置环境变量 ENABLE_HYDE=1
// 例如：ENABLE_HYDE=1 node index.js
const ENABLE_HYDE = process.env.ENABLE_HYDE === '1';
console.log(`[Config] HyDE: ${ENABLE_HYDE ? '已启用' : '已禁用'} (ENABLE_HYDE=${process.env.ENABLE_HYDE || '0'})`);

// 答案口语化改写：默认启用，设置 ENABLE_ANSWER_REWRITE=0 可关闭
const ENABLE_ANSWER_REWRITE = process.env.ENABLE_ANSWER_REWRITE !== '0';
console.log(`[Config] 答案改写: ${ENABLE_ANSWER_REWRITE ? '已启用' : '已禁用'} (ENABLE_ANSWER_REWRITE=${process.env.ENABLE_ANSWER_REWRITE || '1'})`);

// ============ 工具函数 ============
// 去除HTML标签（FAQ answer字段可能包含<p>等标签）
function stripHtmlTags(html) {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

// FAQ关键词精确匹配（不依赖向量搜索）
function matchFAQByKeywords(query, faqList, threshold = 0.5) {
  const queryWords = query.replace(/[？?。.，,、；;：:！!（）()\s]/g, '|').split('|').filter(w => w.length >= 2);
  for (const faq of faqList) {
    if (!faq.keywords || !Array.isArray(faq.keywords)) continue;
    const matchCount = faq.keywords.filter(kw => query.includes(kw)).length;
    if (matchCount > 0) {
      const confidence = Math.min(0.95, 0.5 + matchCount * 0.1);
      if (confidence >= threshold) {
        return { faq, confidence };
      }
    }
  }
  return null;
}

// ============ 日志系统 ============
const { performanceMiddleware, auditLog, errorLog, getLogFiles, readLogFile, cleanOldLogs, writeLog } = require('./logger');

// ============ RAG 向量存储 ============
const {
  addDocumentChunks, semanticSearch, rebuildVectorStore, getStats: getVectorStats,
  buildFAQEmbeddingCache, searchByFAQCacheAsync
} = require('./vector-store');

// 共享 LLM 调用模块（消除各模块中的重复 HTTP 调用代码）
const { callOllamaChat, callOllamaGenerate, callOllamaChatStream } = require('./ollama-client');

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

// ============ 核心AI模块（智能意图理解、多轮对话记忆、LLM智能改写答案、查询改写）============
const { understandIntent, batchUnderstandIntents, fallbackIntent, INTENT_TAXONOMY } = require('./intent-understanding');
const { storeConversationRound, getConversationHistory, enhanceQueryWithMemory, getMemoryStats, clearConversationHistory } = require('./dialogue-memory');
const { rewriteToColloquial, batchRewrite, evaluateQuality, getToneList } = require('./answer-rewriter');
const { rewriteQuery, generateHypotheticalAnswer, hydeSearch: hydeSearchFromWriter, optimizeQuery } = require('./query-rewriter');

// ============ 上传功能模块 ============
const uploadEndpoints = require('./upload-endpoints');

// ============ 知识库管理（动态加载） ============
function loadKnowledgeBases() {
  if (!fs.existsSync(KNOWLEDGE_BASES_PATH)) {
    const defaultKB = [{ id: 'kb_default', name: loadSoftwareInfo().knowledgeBaseName, description: '默认知识库', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), isDefault: true, isActive: true }];
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

// ============ 数据存储（JSON 文件） ============
const DB_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function readDB() {
  const fp = DB_PATH.replace('.db', '.json');
  if (!fs.existsSync(fp)) return { conversations: [], faq_logs: [] };
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    if (!raw.trim()) return { conversations: [], faq_logs: [] }; // 空文件保护
    return JSON.parse(raw);
  } catch (e) {
    console.error('[DB] 读取数据文件失败（将使用空数据）:', e.message);
    return { conversations: [], faq_logs: [] };
  }
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
  console.log(`[searchFAQCandidates] 开始: query="${userMessage}", faqList=${faqList.length}条, threshold=${threshold}`);

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
  // 短查询（如"报销"）也走此路径，长度阈值降为 >= 2
  if (userMessage.length >= 2) {
    try {
      const start = Date.now();
      const searchResults = await searchByFAQCacheAsync(userMessage, null, 5, 0.10);
      const cost = Date.now() - start;
      console.log(`[searchFAQCandidates] FAQ缓存搜索耗时: ${cost}ms, 结果: ${searchResults.length}条`);

      for (const r of searchResults) {
        const faqId = r.parentDocId;
        if (!faqId) continue;
        const faq = faqList.find(f => f.id === faqId);
        if (!faq) continue;
        if (candidates.some(c => c.faq.id === faq.id)) continue;

        // 置信度：优先用余弦相似度（稳定），Rerank 分数作为参考（不覆盖）
        let confidence = r.score || 0;
        // 如果 Rerank 分数显著更高（>0.3），才用它
        if (r.rerankScore !== undefined && r.rerankScore > confidence + 0.2) {
          confidence = r.rerankScore;
        }
        
        // 置信度上限
        if (confidence > 0.90) confidence = 0.90;
        // 置信度下限（0.05：匹配 RAG 搜索阈值）
        if (confidence < 0.05) continue;

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
          // 置信度：优先用余弦相似度，Rerank 分数只作为参考
          let confidence = finalScore;
          if (r.rerankScore !== undefined && r.rerankScore > confidence + 0.2) {
            confidence = r.rerankScore;
          }
          if (confidence > 0.85) confidence = 0.85;
          if (confidence < 0.05) continue;
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

// ============ 调用 Ollama 生成回复（RAG 增强 + 查询改写 + HyDE） ============
async function generateAgentReply(sessionId, userMessage, conversationHistory, intentResult, onToken) {
  // 步骤0：查询改写（短查询扩展 + 代词消解）
  let optimizedQuery = userMessage;
  let queryInfo = { original: userMessage, rewritten: userMessage, isRewritten: false };
  
  try {
    // 如果查询较短（<10个字），尝试改写
    if (userMessage.length < 10) {
      queryInfo = await rewriteQuery(userMessage, conversationHistory);
      if (queryInfo.isRewritten) {
        optimizedQuery = queryInfo.rewritten;
        console.log(`[QueryRewrite] 查询改写: "${userMessage}" → "${optimizedQuery}"`);
      }
    }
  } catch (e) {
    console.warn('[QueryRewrite] 改写失败，使用原查询:', e.message);
    optimizedQuery = userMessage;
  }
  
  // 步骤0.5：可选 - HyDE搜索（通过环境变量控制，默认关闭，因为会增加延迟）
  const useHyDE = process.env.ENABLE_HYDE === '1';
  let hydeResults = null;
  
  if (useHyDE) {
    try {
      console.log(`[RAG] 使用HyDE搜索`);
      hydeResults = await hydeSearch(optimizedQuery, 3, 0.05, true);
    } catch (e) {
      console.warn('[RAG] HyDE搜索失败，降级为常规搜索:', e.message);
    }
  }
  
  // FAQ 精确匹配优先（使用原查询）
  if (intentResult.matchedFAQ) {
    return stripHtmlTags(intentResult.matchedFAQ.answer);
  }
  
  // RAG 语义搜索：获取相关文档片段（使用改写后的查询）
  let ragContext = '';
  try {
    // 如果使用HyDE且成功，用HyDE结果
    if (hydeResults && hydeResults.length > 0) {
      ragContext = '\n\n===== 相关资料（HyDE搜索结果）=====\n';
      const faqList = getFAQ();
      hydeResults.forEach((r, i) => {
        const faq = faqList.find(f => f.id === r.parentDocId);
        const content = faq ? `Q: ${faq.question}\nA: ${stripHtmlTags(faq.answer)}` : r.content;
        ragContext += `\n[资料${i+1}]（相关度：${(r.score * 100).toFixed(1)}%）\n${content.slice(0, 800)}\n`;
      });
      ragContext += '\n===== 请基于以上资料回答 =====\n';
      console.log(`[RAG] HyDE注入 ${hydeResults.length} 条相关文档`);
    } else {
      // 常规搜索（使用改写后的查询）
      const intentName = intentResult?.intent || null;
      const searchResults = await searchByFAQCacheAsync(optimizedQuery, intentName, 3, 0.12);
      if (searchResults && searchResults.length > 0) {
        ragContext = '\n\n===== 相关资料（语义搜索结果）=====\n';
        // 通过 parentDocId 找到完整 FAQ 内容
        const faqList = getFAQ();
        searchResults.forEach((r, i) => {
          const faq = faqList.find(f => f.id === r.parentDocId);
          const content = faq ? `Q: ${faq.question}\nA: ${stripHtmlTags(faq.answer)}` : r.content;
          ragContext += `\n[资料${i+1}]（相关度：${(r.score * 100).toFixed(1)}%）\n${content.slice(0, 800)}\n`;
        });
        ragContext += '\n===== 请基于以上资料回答 =====\n';
        console.log(`[RAG] 注入 ${searchResults.length} 条相关文档，top score=${(searchResults[0].score * 100).toFixed(1)}%`);
      }
    }
  } catch (e) {
    console.error('[RAG] 语义搜索失败，降级到普通模式：', e.message);
  }
  
  // 构建 prompt
  const sw = loadSoftwareInfo();
  const faqContext = getFAQ().map(f => `Q: ${f.question}\nA: ${stripHtmlTags(f.answer)}`).join('\n\n');
  
  const systemPrompt = `你是「${sw.softwareName}」的智能客服，名字叫「${sw.assistantName}」。
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
    const reply = await callOllamaChatStream(messages, {
      baseURL: OLLAMA_BASE_URL,
      model: MODEL_NAME,
      temperature: 0.3,
      max_tokens: 500
    }, typeof onToken === 'function' ? onToken : () => {});
    return reply || '抱歉，我暂时无法回答您的问题，正在为您转接人工客服...';
  } catch (err) {
    console.error('生成回复失败：', err);
    return '抱歉，系统暂时繁忙，正在为您转接人工客服，请稍候...';
  }
}

// ============ Express + WebSocket 服务 ============
const app = express();
app.use(cors());
// 提高 JSON body 上限（支持配置批量导入等大负载；内部管理工具，非公网暴露）
app.use(express.json({ limit: '10mb' }));
// 性能监控中间件（记录所有API响应时间）
app.use(performanceMiddleware);
// 静态文件服务（禁止缓存 index.html，带哈希的资源可长期缓存）
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    // index.html 不缓存，确保前端更新后用户能获取最新版本
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // 带哈希的JS/CSS文件（如 index-D2yTSMbE.js）可长期缓存
    else if (filePath.match(/index-[A-Za-z0-9]+\.(js|css)$/)) {
      res.setHeader('Cache-Control', 'max-age=31536000'); // 1年
    }
  }
}));
// 静态文件服务：uploads 目录（图片/附件）
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ============ RAG 管理统一路由（整合意图理解、答案改写、FAQ、知识库）============
// 说明：以下路由已迁移到 rag-admin.js，通过统一 Router 管理
// 路径保持不变（/api/admin/*），前端无需修改
const ragAdminRouter = require('./rag-admin');
app.use('/api/admin', ragAdminRouter);

// 致远 OA（seeyon / A8）基础信息管理对接接口
const oaAdminRouter = require('./oa-admin');
app.use('/api/admin/oa', oaAdminRouter);
const uploadRouter = require('./upload-endpoints');
app.use('/api/admin', uploadRouter);
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
// ============ 用户认证系统 ============
auth.setupAuthRoutes(app);

// ============ SSO配置测试接口 ============
// 无需认证即可访问，用于验证SSO配置是否正确
app.get('/api/auth/sso/test', (req, res) => {
  const config = {
    sso_enabled: auth.SSO_ENABLED,
    sso_provider: auth.SSO_PROVIDER,
    config_valid: auth.ssoConfigValidation.valid,
    errors: auth.ssoConfigValidation.errors,
    warnings: auth.ssoConfigValidation.warnings,
    a8: {
      configured: !!(auth.A8_SERVER_URL),
      server_url: auth.A8_SERVER_URL || '(未配置)',
      cas_configured: !!(auth.A8_CAS_SERVER_URL),
      cas_server_url: auth.A8_CAS_SERVER_URL || '(未配置)',
      trust_mode: auth.A8_SSO_TRUST_MODE
    },
    oauth2: {
      configured: !!(process.env.SSO_LOGIN_URL && process.env.SSO_VERIFY_URL),
      login_url: process.env.SSO_LOGIN_URL || '(未配置)',
      verify_url: process.env.SSO_VERIFY_URL || '(未配置)',
      client_id_configured: !!process.env.SSO_CLIENT_ID
    }
  };
  
  res.json({
    success: true,
    config,
    timestamp: new Date().toISOString(),
    message: config.config_valid 
      ? '✅ SSO配置验证通过' 
      : '⚠️ SSO配置存在问题，请检查errors和warnings'
  });
});

// ============ 多轮对话记忆 API ============
// 为所有聊天API添加认证中间件（登录后才能使用）
app.use('/api/chat', auth.authMiddleware);
app.use('/api/eval', auth.authMiddleware);

// ============ 用户对话记录 API ============
// 普通用户查看自己的对话记录（需要认证，但不需要管理员权限）
app.get('/api/user/conversations', auth.authMiddleware, (req, res) => {
  try {
    const db = readDB();
    // 只返回当前用户的对话记录
    const list = db.conversations.filter(c => c.user_id === req.user.userId);
    
    // 按更新时间倒序排列
    list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    
    // 简化返回数据（不包含完整消息内容，只返回概要）
    const summary = list.map(c => {
      let messages = [];
      try { messages = typeof c.messages === 'string' ? JSON.parse(c.messages) : c.messages; } catch (e) {}
      const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
      
      return {
        session_id: c.session_id,
        user_id: c.user_id,
        intent: c.intent,
        resolved: c.resolved,
        created_at: c.created_at,
        updated_at: c.updated_at,
        messageCount: messages.length,
        lastMessage: lastMessage ? lastMessage.content.slice(0, 100) : '',
        lastMessageRole: lastMessage ? lastMessage.role : null
      };
    });
    
    res.json({ success: true, data: summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 存储对话轮次
app.post('/api/chat/store', auth.authMiddleware, (req, res) => {
  try {
    const { sessionId, userQuery, aiResponse, intent, entities } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'sessionId 不能为空' });
    
    // 获取 userId（从认证信息中）
    const userId = req.user ? req.user.userId : null;
    
    const result = storeConversationRound(sessionId, {
      userQuery: userQuery || '',
      aiResponse: aiResponse || '',
      intent: intent || null,
      entities: entities || [],
      timestamp: Date.now()
    }, userId);  // 传递 userId
    
    res.json({ success: true, roundId: result.roundId, totalRounds: result.totalRounds });
  } catch (err) {
    console.error('[Memory API] 存储失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 获取对话历史
app.post('/api/chat/history', auth.authMiddleware, (req, res) => {
  try {
    const { sessionId, limit = 10, includeContext = false, userId } = req.body;
    
    // 优先使用 userId（从请求体或认证信息）
    const effectiveUserId = userId || (req.user ? req.user.userId : null);
    
    if (!sessionId && !effectiveUserId) {
      return res.status(400).json({ error: 'sessionId 或 userId 必填' });
    }
    
    const result = getConversationHistory(sessionId, limit, includeContext, effectiveUserId);
    res.json({ success: true, history: result.history, total: result.history.length, context: result.context });
  } catch (err) {
    console.error('[Memory API] 获取历史失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 增强查询（指代消解 + 上下文补全）
app.post('/api/chat/enhance', auth.authMiddleware, async (req, res) => {
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

// 获取记忆统计（需要认证）
app.get('/api/chat/memory-stats', auth.authMiddleware, (req, res) => {
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
    res.json({ success: true, ...stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清空会话历史（需要认证）
app.post('/api/chat/clear', auth.authMiddleware, (req, res) => {
  try {
    const { sessionId } = req.body;
    clearConversationHistory(sessionId || null);
    auditLog('chat_clear', req.user ? req.user.username : 'unknown', { sessionId: sessionId || null });
    res.json({ success: true, message: sessionId ? '会话已清空' : '所有会话已清空' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============ 意图在线标注（聊天端纠错，公开采集）============
// 坐席/用户在前端对"识别意图"点纠错时调用；无需 admin，token 可选（用于署名）
const intentFeedback = require('./intent-feedback');
app.post('/api/intent-correct', (req, res) => {
  try {
    const { userMessage, originalIntent, correctedIntent, note, makeRule, sessionId, messageId } = req.body;
    // 尝试从 token 取署名（失败则记为匿名）
    let correctedBy = 'anonymous';
    const authHeader = req.headers['authorization'] || '';
    if (authHeader.startsWith('Bearer ')) {
      try {
        const decoded = auth.verifyToken(authHeader.slice(7));
        const u = auth.findUserById ? auth.findUserById(decoded.userId) : null;
        correctedBy = u ? (u.username || u.name || 'user') : 'user';
      } catch (e) { correctedBy = 'anonymous'; }
    }
    const record = intentFeedback.addCorrection({
      source: 'chat',
      sessionId: sessionId || null,
      messageId: messageId || null,
      userMessage,
      originalIntent: originalIntent || null,
      correctedIntent,
      correctedBy,
      note: note || '',
      makeRule: !!makeRule
    });
    res.json({ success: true, correction: record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============ RAG 评估接口 ============
// 用于测试RAG检索质量
app.post('/api/eval/rag', auth.authMiddleware, async (req, res) => {
  try {
    const { query, category = null, threshold = 0.12 } = req.body;
    if (!query) return res.status(400).json({ error: 'query 不能为空' });
    
    console.log(`[评估] 查询: "${query}", category: ${category || '全部'}`);
    
    const candidates = await searchFAQCandidates(query, threshold, category);
    
    console.log(`[评估] 检索到 ${candidates.length} 个候选`);
    
    // 返回详细结果
    const results = candidates.map(c => ({
      id: c.faq.id,
      question: c.faq.question,
      answer: stripHtmlTags(c.faq.answer).substring(0, 200),
      confidence: c.confidence,
      intent: c.intent,
      fromRAG: c.fromRAG || false,
      ragScore: c.ragScore || 0
    }));
    
    res.json({
      success: true,
      query,
      candidateCount: results.length,
      candidates: results
    });
  } catch (err) {
    console.error('[评估] 错误:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============ LLM 智能改写答案 API（已迁移到 rag-admin.js）============

// ============ 知识库管理 API（已迁移到 rag-admin.js）============


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

// 公开接口：前端读取软件信息（标题/助手名/欢迎语等），无需登录
app.get('/api/public/software-info', (req, res) => {
  try { res.json({ success: true, data: loadSoftwareInfo() }); } catch (err) { res.status(500).json({ error: err.message }); }
});

// 公开公告（登录页/聊天页展示，无需登录）
app.get('/api/public/announcement', (req, res) => {
  try {
    const { loadAnnouncement } = require('./data');
    res.json({ success: true, data: loadAnnouncement() });
  } catch (err) { res.status(500).json({ error: err.message }); }
});













// ============ 向量库管理 API ============
// 获取向量库统计

// 重建向量库（从现有FAQ重新向量化）

// ============ 上传文件列表 ============

// ============ 删除上传文件 ============

// ============ 基础信息：组织架构管理（已迁移到 rag-admin.js）============
// 上述路由已迁移到 rag-admin.js，通过 router.get('/org', ...) 注册

// // ============ 基础信息：人员信息管理 ============
// app.get('/api/admin/personnel', (req, res) => {
//   try {
//     const list = loadPersonnel();
//     const { orgId } = req.query;
//     const filtered = orgId ? list.filter(p => p.orgId === orgId) : list;
//     res.json(filtered);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 
// app.post('/api/admin/personnel', (req, res) => {
//   try {
//     const { name, username, password, orgId, orgName, roleId, roleName } = req.body;
//     if (!name || !name.trim()) return res.status(400).json({ error: '姓名必填' });
//     if (!username || !username.trim()) return res.status(400).json({ error: '用户名必填' });
//     const list = loadPersonnel();
//     if (list.some(p => p.username === username.trim())) return res.status(400).json({ error: '用户名已存在' });
//     const newPerson = {
//       id: 'user_' + Date.now(),
//       name: name.trim(),
//       username: username.trim(),
//       password: password || '123456',
//       orgId: orgId || null,
//       orgName: orgName || '',
//       roleId: roleId || null,
//       roleName: roleName || '',
//       isActive: true,
//       createdAt: new Date().toISOString(),
//       updatedAt: new Date().toISOString(),
//       lastLoginAt: null
//     };
//     list.push(newPerson);
//     savePersonnel(list);
//     res.json({ success: true, data: newPerson });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 
// app.put('/api/admin/personnel/:id', (req, res) => {
//   try {
//     const list = loadPersonnel();
//     const idx = list.findIndex(p => p.id === req.params.id);
//     if (idx === -1) return res.status(404).json({ error: 'Not found' });
//     const { name, username, password, orgId, orgName, roleId, roleName, isActive } = req.body;
//     if (name && name.trim()) list[idx].name = name.trim();
//     if (username && username.trim()) {
//       if (list.some(p => p.username === username.trim() && p.id !== req.params.id)) {
//         return res.status(400).json({ error: '用户名已存在' });
//       }
//       list[idx].username = username.trim();
//     }
//     if (password && password.trim()) list[idx].password = password.trim();
//     if (orgId !== undefined) { list[idx].orgId = orgId || null; list[idx].orgName = orgName || ''; }
//     if (roleId !== undefined) { list[idx].roleId = roleId || null; list[idx].roleName = roleName || ''; }
//     if (isActive !== undefined) list[idx].isActive = isActive;
//     list[idx].updatedAt = new Date().toISOString();
//     savePersonnel(list);
//     res.json({ success: true, data: list[idx] });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 
// app.delete('/api/admin/personnel/:id', (req, res) => {
//   try {
//     const list = loadPersonnel();
//     const newList = list.filter(p => p.id !== req.params.id);
//     if (newList.length === list.length) return res.status(404).json({ error: 'Not found' });
//     savePersonnel(newList);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 
// // ============ 基础信息：权限管理 ============
// app.get('/api/admin/permissions', (req, res) => {
//   try { res.json(loadPermissions()); } catch (err) { res.status(500).json({ error: err.message }); }
// });
// 
// app.post('/api/admin/permissions', (req, res) => {
//   try {
//     const { roleName, categoryId, categoryName, permissions } = req.body;
//     if (!roleName || !roleName.trim()) return res.status(400).json({ error: '角色名称必填' });
//     const list = loadPermissions();
//     const newRole = {
//       id: 'perm_' + Date.now(),
//       roleName: roleName.trim(),
//       roleKey: roleName.trim().replace(/\s+/g, '_').toLowerCase(),
//       categoryId: categoryId || null,
//       categoryName: categoryName || '全部',
//       permissions: permissions || [],
//       isSystem: false,
//       createdAt: new Date().toISOString(),
//       updatedAt: new Date().toISOString()
//     };
//     list.push(newRole);
//     savePermissions(list);
//     res.json({ success: true, data: newRole });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 
// app.put('/api/admin/permissions/:id', (req, res) => {
//   try {
//     const list = loadPermissions();
//     const idx = list.findIndex(r => r.id === req.params.id);
//     if (idx === -1) return res.status(404).json({ error: 'Not found' });
//     if (list[idx].isSystem) return res.status(400).json({ error: '系统内置角色不可修改' });
//     const { roleName, categoryId, categoryName, permissions } = req.body;
//     if (roleName && roleName.trim()) list[idx].roleName = roleName.trim();
//     if (categoryId !== undefined) { list[idx].categoryId = categoryId || null; list[idx].categoryName = categoryName || '全部'; }
//     if (permissions) list[idx].permissions = permissions;
//     list[idx].updatedAt = new Date().toISOString();
//     savePermissions(list);
//     res.json({ success: true, data: list[idx] });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 
// app.delete('/api/admin/permissions/:id', (req, res) => {
//   try {
//     const list = loadPermissions();
//     const target = list.find(r => r.id === req.params.id);
//     if (!target) return res.status(404).json({ error: 'Not found' });
//     if (target.isSystem) return res.status(400).json({ error: '系统内置角色不可删除' });
//     const newList = list.filter(r => r.id !== req.params.id);
//     savePermissions(newList);
//     res.json({ success: true });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 
// // ============ 基础信息：A8配置管理 ============
// app.get('/api/admin/a8-config', (req, res) => {
//   try { res.json(loadA8Config()); } catch (err) { res.status(500).json({ error: err.message }); }
// });
// 
// app.put('/api/admin/a8-config', (req, res) => {
//   try {
//     const config = loadA8Config();
//     const { enabled, orgApiUrl, personnelApiUrl, syncInterval, auth } = req.body;
//     if (enabled !== undefined) config.enabled = enabled;
//     if (orgApiUrl !== undefined) config.orgApiUrl = orgApiUrl;
//     if (personnelApiUrl !== undefined) config.personnelApiUrl = personnelApiUrl;
//     if (syncInterval !== undefined) config.syncInterval = syncInterval;
//     if (auth) config.auth = auth;
//     config.updatedAt = new Date().toISOString();
//     saveA8Config(config);
//     res.json({ success: true, data: config });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 
// app.post('/api/admin/a8-test', async (req, res) => {
//   try {
//     const config = loadA8Config();
//     if (!config.enabled) return res.status(400).json({ error: 'A8集成未启用' });
//     if (!config.orgApiUrl) return res.status(400).json({ error: '请先配置组织架构API地址' });
//     const axios = require('axios');
//     const authHeader = config.auth.type === 'basic'
//       ? { Authorization: 'Basic ' + Buffer.from(config.auth.username + ':' + config.auth.password).toString('base64') }
//       : {};
//     const response = await axios.get(config.orgApiUrl, { headers: authHeader, timeout: 5000 });
//     res.json({ success: true, message: '连接成功', status: response.status });
//   } catch (err) {
//     res.status(500).json({ error: '连接失败：' + (err.response?.data || err.message) });
//   }
// });
// 
// app.post('/api/admin/a8-sync', async (req, res) => {
//   try {
//     const config = loadA8Config();
//     if (!config.enabled) return res.status(400).json({ error: 'A8集成未启用' });
//     // TODO: 实现同步逻辑
//     config.lastSyncTime = new Date().toISOString();
//     saveA8Config(config);
//     res.json({ success: true, message: '同步完成' });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
// 分类管理、FAQ管理、上传管理、向量管理等API（保留在 index.js 中）

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

// ============ 对话记录 API（已迁移到 rag-admin.js）============

// ============ WebSocket 服务 ============
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const sessions = new Map();

function getOrCreateConversation(sessionId, userId = null) {
  const db = readDB();
  let conv = db.conversations.find(c => c.session_id === sessionId);
  if (conv) return conv;
  
  const id = uuidv4();
  const now = new Date().toISOString();
  conv = { id, session_id: sessionId, user_id: userId, messages: JSON.stringify([]), intent: null, resolved: false, created_at: now, updated_at: now };
  db.conversations.push(conv);
  writeDB(db);
  return { ...conv, messages: [] };
}

function saveMessage(sessionId, role, content, intent = null, userId = null) {
  const db = readDB();
  let convIdx = db.conversations.findIndex(c => c.session_id === sessionId);
  if (convIdx === -1) {
    // session 不存在，自动创建（含 userId）
    const conv = getOrCreateConversation(sessionId, userId);
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
        
        // 强制认证：必须携带有效token
        if (!msg.token) {
          ws.send(JSON.stringify({ type: 'error', message: '请先登录' }));
          ws.close();
          return;
        }
        
        const decoded = auth.verifyToken(msg.token);
        if (!decoded) {
          ws.send(JSON.stringify({ type: 'error', message: '登录已过期，请重新登录' }));
          ws.close();
          return;
        }
        
        const user = auth.findUserById(decoded.userId);
        if (!user || !user.isActive) {
          ws.send(JSON.stringify({ type: 'error', message: '账号已被禁用' }));
          ws.close();
          return;
        }
        
        const userId = user.id;
        console.log(`[WS] 用户认证成功: ${user.username} (${user.name})`);
        
        sessions.set(sessionId, { ws, history: [], category, userId });
        ws.send(JSON.stringify({ type: 'init', sessionId, userId }));
        
        // 加载对话记忆：优先从用户记忆文件加载（跨会话持久化）
        try {
          const memoryResult = getConversationHistory(null, 0, false, userId);
          if (memoryResult.success && memoryResult.history.length > 0) {
            // 将对话记忆转换为前端消息格式
            const messages = memoryResult.history.map(round => [
              { role: 'user', content: round.userQuery, timestamp: new Date(round.timestamp).toISOString() },
              { role: 'assistant', content: round.aiResponse, timestamp: new Date(round.timestamp + 100).toISOString() }
            ]).flat().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            
            ws.send(JSON.stringify({ type: 'history', messages }));
            console.log(`[WS] 已从用户记忆加载 ${messages.length} 条消息: ${user.username}`);
          } else {
            // 如果没有用户记忆，则从 conversations.db 加载（向后兼容）
            const conv = getOrCreateConversation(sessionId, userId);
            const dbMessages = typeof conv.messages === 'string' ? JSON.parse(conv.messages) : conv.messages;
            if (dbMessages.length > 0) {
              ws.send(JSON.stringify({ type: 'history', messages: dbMessages }));
              console.log(`[WS] 已从数据库加载 ${dbMessages.length} 条消息: ${user.username}`);
            }
          }
        } catch (err) {
          console.warn(`[WS] 加载用户记忆失败，回退到数据库:`, err.message);
          const conv = getOrCreateConversation(sessionId, userId);
          const dbMessages = typeof conv.messages === 'string' ? JSON.parse(conv.messages) : conv.messages;
          if (dbMessages.length > 0) {
            ws.send(JSON.stringify({ type: 'history', messages: dbMessages }));
          }
        }
        return;
      }
      
      if (msg.type === 'message' && sessionId) {
        const userMessage = msg.content;
        const category = (() => { const s = sessions.get(sessionId); return s ? s.category : null; })();
        
        // 获取 userId
        const sessionData = sessions.get(sessionId);
        const userId = sessionData ? sessionData.userId : null;
        
        saveMessage(sessionId, 'user', userMessage, null, userId);
        
        // 存储最后一条用户消息（用于candidate_select场景）
        if (sessionData) {
          sessionData.lastUserMessage = userMessage;
        }
        
        // 语义搜索候选 FAQ（本地快速匹配 → FAQ缓存搜索 → Rerank重排序）
        console.log(`[WS] 收到消息: "${userMessage}", 开始语义搜索...`);
        const candidates = await searchFAQCandidates(userMessage, 0.12, category);
        console.log(`[WS] 语义搜索完成, 候选问题数量: ${candidates.length}`);
        
        if (candidates.length > 0) {
          // 高置信度（≥0.6）：直接返回最佳答案，不等待用户点击，不调LLM
          if (candidates[0].confidence >= 0.6) {
            const best = candidates[0];
            const rawAnswer = stripHtmlTags(best.faq.answer);
            
            // 口语化改写（短答案跳过，避免不必要延迟）
            let reply = rawAnswer;
            if (ENABLE_ANSWER_REWRITE && rawAnswer.length > 20) {
              ws.send(JSON.stringify({ type: 'typing', status: true }));
              try {
                reply = await rewriteToColloquial(rawAnswer, {
                  userMessage,
                  tone: 'friendly',
                  faqId: best.faq.id,
                  intent: best.intent ? { primaryIntent: { level1: best.intent } } : null
                });
                console.log(`[WS] 答案已口语化改写，原长度: ${rawAnswer.length} → 新长度: ${reply.length}`);
              } catch (e) {
                console.error('[WS] 答案改写失败，使用原答案:', e.message);
                reply = rawAnswer;
              }
              ws.send(JSON.stringify({ type: 'typing', status: false }));
            }
            
            // 添加附件信息（区分图片和文件）
            if (best.faq.attachments && best.faq.attachments.length > 0) {
              reply += '\n\n📎 **相关附件**：\n';
              best.faq.attachments.forEach(att => {
                const downloadUrl = `/uploads/faq_attachments/${att.filename}`;
                const ext = att.originalName.split('.').pop().toLowerCase();
                const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
                
                if (imageExts.includes(ext)) {
                  // 图片：使用 Markdown 图片语法
                  reply += `![${att.originalName}](${downloadUrl})\n`;
                } else {
                  // 文件：使用 Markdown 链接
                  reply += `- 📎 [${att.originalName}](${downloadUrl})（点击下载）\n`;
                }
              });
            }
            
            saveMessage(sessionId, 'assistant', reply, best.intent, userId);
            
            // 存储到对话记忆（按userId持久化）
            storeConversationRound(sessionId, {
              userQuery: userMessage,
              aiResponse: reply,
              intent: best.intent,
              entities: [],
              timestamp: Date.now()
            }, userId);
            
            ws.send(JSON.stringify({
              type: 'message',
              content: reply,
              timestamp: new Date().toISOString(),
              messageId: uuidv4(),
              query: userMessage,
              intent: best.intent,
              intentLevel2: null,
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
            answer: stripHtmlTags(c.faq.answer),
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
        // 先获取意图 understanding
        const intentResult = await understandIntent(userMessage);
        const pi = intentResult.primaryIntent || {};
        
        ws.send(JSON.stringify({
          type: 'intent',
          intent: pi.level1 || null,
          intentLevel2: pi.level2 || null,
          confidence: (typeof pi.confidence === 'number') ? pi.confidence : null,
        }));
        
        // 记录 FAQ 日志
        const db = readDB();
        db.faq_logs.push({
          id: uuidv4(), session_id: sessionId, question: userMessage,
          matched_question: intentResult.matchedFAQ?.question || null,
          intent: pi.level1 || null,
          intentLevel2: pi.level2 || null,
          intentConfidence: (typeof pi.confidence === 'number') ? pi.confidence : null,
          confidence: (typeof pi.confidence === 'number') ? pi.confidence : null,
          transferred: 0, created_at: new Date().toISOString()
        });
        writeDB(db);
        
        if (pi.confidence < 0.4) {
          const reply = '正在为您转接人工客服，请稍候...我们的工作时间是 9:00-21:00，请您耐心等待。';
          saveMessage(sessionId, 'assistant', reply, pi.level1, userId);
          
          // 存储到对话记忆（按userId持久化）
          storeConversationRound(sessionId, {
            userQuery: userMessage,
            aiResponse: reply,
            intent: pi.level1,
            entities: [],
            timestamp: Date.now()
          }, userId);
          
          ws.send(JSON.stringify({
            type: 'message', content: reply,
            timestamp: new Date().toISOString(),
            messageId: uuidv4(),
            query: userMessage,
            intent: pi.level1 || null,
            intentLevel2: pi.level2 || null,
            confidence: (typeof pi.confidence === 'number') ? pi.confidence : null
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
          let streamed = '';
          const reply = await generateAgentReply(sessionId, userMessage, history, intentResult, (chunk) => {
            if (!chunk) return;
            streamed += chunk;
            // 首个 token 到达即关闭“思考中”动画，开始流式渲染
            if (streamed.length === chunk.length) {
              ws.send(JSON.stringify({ type: 'typing', status: false }));
            }
            ws.send(JSON.stringify({ type: 'stream', content: chunk }));
          });
          const finalReply = reply || streamed || '抱歉，我暂时无法回答您的问题，正在为您转接人工客服...';

          saveMessage(sessionId, 'assistant', finalReply, intentResult.intent, userId);

          // 存储到对话记忆（按userId持久化）
          storeConversationRound(sessionId, {
            userQuery: userMessage,
            aiResponse: finalReply,
            intent: intentResult.intent,
            entities: [],
            timestamp: Date.now()
          }, userId);

          ws.send(JSON.stringify({
            type: 'stream_end',
            content: finalReply,
            timestamp: new Date().toISOString(),
            messageId: uuidv4(),
            query: userMessage,
            intent: pi.level1 || null,
            intentLevel2: pi.level2 || null,
            confidence: (typeof pi.confidence === 'number') ? pi.confidence : null
          }));
        } catch (err) {
          console.error('生成回复失败：', err);
          const fallback = '抱歉，我暂时无法处理您的问题，正在为您转接人工客服...';
          saveMessage(sessionId, 'assistant', fallback, pi.level1, userId);

          // 存储到对话记忆（按userId持久化）
          storeConversationRound(sessionId, {
            userQuery: userMessage,
            aiResponse: fallback,
            intent: pi.level1,
            entities: [],
            timestamp: Date.now()
          }, userId);

          ws.send(JSON.stringify({ type: 'message', content: fallback, timestamp: new Date().toISOString(), fallback: true, messageId: uuidv4(), query: userMessage, intent: pi.level1 || null, intentLevel2: pi.level2 || null, confidence: (typeof pi.confidence === 'number') ? pi.confidence : null }));
        } finally {
          ws.send(JSON.stringify({ type: 'typing', status: false }));
        }
      }
      
      if (msg.type === 'candidate_select' && sessionId) {
        const { candidateId } = msg;
        // 获取 userId（从 session 数据）
        const sessionData = sessions.get(sessionId);
        const userId = sessionData ? sessionData.userId : null;
        const faqList = getFAQ();
        const faq = faqList.find(f => f.id === candidateId);
        if (faq) {
          const rawAnswer = stripHtmlTags(faq.answer);
          
          // 获取用户原始问题（用于改写上下文）
          const userMessageForMemory = (() => {
            const s = sessions.get(sessionId);
            return s && s.lastUserMessage ? s.lastUserMessage : '';
          })();
          
          // 口语化改写
          let reply = rawAnswer;
          if (ENABLE_ANSWER_REWRITE && rawAnswer.length > 20) {
            ws.send(JSON.stringify({ type: 'typing', status: true }));
            try {
              reply = await rewriteToColloquial(rawAnswer, {
                userMessage: userMessageForMemory,
                tone: 'friendly',
                faqId: candidateId,
                intent: faq.intent ? { primaryIntent: { level1: faq.intent } } : null
              });
              console.log(`[WS] 候选答案已口语化改写，原长度: ${rawAnswer.length} → 新长度: ${reply.length}`);
            } catch (e) {
              console.error('[WS] 答案改写失败，使用原答案:', e.message);
              reply = rawAnswer;
            }
            ws.send(JSON.stringify({ type: 'typing', status: false }));
          }
          
          // 添加附件信息（区分图片和文件）
          if (faq.attachments && faq.attachments.length > 0) {
            reply += '\n\n📎 **相关附件**：\n';
            faq.attachments.forEach(att => {
              const downloadUrl = `/uploads/faq_attachments/${att.filename}`;
              const ext = att.originalName.split('.').pop().toLowerCase();
              const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
              
              if (imageExts.includes(ext)) {
                // 图片：使用 Markdown 图片语法
                reply += `![${att.originalName}](${downloadUrl})\n`;
              } else {
                // 文件：使用 Markdown 链接
                reply += `- 📎 [${att.originalName}](${downloadUrl})（点击下载）\n`;
              }
            });
          }
          
          saveMessage(sessionId, 'assistant', reply, faq.intent, userId);
          
          // 存储到对话记忆（按userId持久化）
          storeConversationRound(sessionId, {
            userQuery: userMessageForMemory,
            aiResponse: reply,
            intent: faq.intent,
            entities: [],
            timestamp: Date.now()
          }, userId);
          
          ws.send(JSON.stringify({
            type: 'message', content: reply,
            timestamp: new Date().toISOString(),
            intent: faq.intent, confidence: 1.0, fallback: true
          }));
        }
        return;
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

// SPA 回退：只回退非 /api/ 的路径（必须放在所有 API 路由之后）
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    // API 路径不存在，返回 404
    return res.status(404).json({ error: `API 路径不存在: ${req.method} ${req.path}` });
  }
  // 非 API 路径，返回前端 index.html（支持 SPA 路由）
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理：把 body-parser / 同步异常转为 JSON，避免返回 HTML 错误页导致前端 catch 到固定文案
app.use((err, req, res, next) => {
  console.error('[Global Error]', err.stack || err.message || err);
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ success: false, error: '请求体格式错误，请检查 Content-Type 是否与 body 匹配：' + err.message });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: '文件过大，单文件上限 10MB' });
  }
  res.status(err.status || err.statusCode || 500).json({ success: false, error: err.message || '服务器内部错误' });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🤖 ${loadSoftwareInfo().softwareName}后端服务启动成功！`);
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

  // 启动模型自动切换管理器
  try {
    modelSwitcher.startAutoSwitch(60000); // 每60秒检查一次
    console.log(`   模型自动切换: 已启用（间隔60秒）`);
  } catch (e) {
    console.warn(`   模型自动切换启动失败: ${e.message}`);
  }
});
