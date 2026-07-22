/**
 * 多轮对话记忆模块
 * 功能：上下文关联存储与检索、指代消解、话题链追踪
 */

const fs = require('fs');
const path = require('path');
const jieba = require('nodejieba'); // 中文分词库
const http = require('http');
// 引入模型配置中心，使 embedding 模型与地址可动态配置
const modelSwitcher = require('./model-switcher');

// 初始化nodejieba（使用默认词典）
jieba.load();

// ============ 配置常量 ============
const MEMORY_DIR = path.join(__dirname, '../data/dialogue-memory');
const MAX_HISTORY_ROUNDS = 50;   // 单会话最大轮次
const MAX_CONTEXT_LENGTH = 20;    // 用于增强查询的最近轮次数
const TOPIC_SIMILARITY_THRESHOLD = 0.6; // 话题相似度阈值（预留）
const MAX_KEY_ENTITIES = 10;     // 返回的关键实体上限
const MAX_COREFERENCE_ENTITIES = 5; // 指代消解保留的实体数
const ENTITY_FREQ_THRESHOLD = 1;  // 关键实体最低出现次数

// bge-m3向量嵌入模型配置（地址/模型名从模型配置中心动态读取，可在前端模型设置页配置）
const BGE_HOST = '172.17.6.18';
const BGE_PORT = 11434;
const BGE_MODEL = 'bge-m3:latest';
// 动态读取 embedding 模型与 Ollama 地址（配置缺失回退默认常量）
function getBgeModel() {
  try {
    if (modelSwitcher && typeof modelSwitcher.getEmbeddingModel === 'function') {
      const m = modelSwitcher.getEmbeddingModel();
      if (m) return m;
    }
  } catch (e) { /* 忽略 */ }
  return BGE_MODEL;
}
function getBgeConn() {
  try {
    if (modelSwitcher && typeof modelSwitcher.parseOllamaBaseUrl === 'function') {
      return modelSwitcher.parseOllamaBaseUrl();
    }
  } catch (e) { /* 忽略 */ }
  return { hostname: BGE_HOST, port: BGE_PORT };
}
const SIMILARITY_THRESHOLD = 0.5; // 语义相似度阈值

// 中文停用词（简单版）
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', 
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', 
  '自己', '这', '那', '什么', '怎么', '如何', '为什么', '吗', '呢', '吧', '啊', '嗯'
]);

// ============ 嵌入向量缓存（性能优化）============
const embeddingCache = new Map();
const CACHE_SIZE_LIMIT = 1000; // 缓存上限1000条

/**
 * 异步预计算嵌入向量（存储时调用，不阻塞主流程）
 * @param {string} sessionId
 * @param {Object} round - 对话轮次对象
 */
async function precomputeEmbedding(sessionId, round) {
  try {
    const text = round.userQuery + ' ' + (round.aiResponse || '');
    const embedding = await getEmbedding(text);
    
    // 存入内存缓存
    embeddingCache.set(round.roundId, embedding);
    
    // 存入磁盘缓存
    const cache = loadEmbeddingCache(sessionId);
    cache[round.roundId] = embedding;
    saveEmbeddingCache(sessionId, cache);
    
    console.log(`[DialogueMemory] 预计算嵌入向量成功: ${round.roundId}`);
  } catch (err) {
    console.warn(`[DialogueMemory] 预计算嵌入向量失败 ${round.roundId}:`, err.message);
  }
}

/**
 * 获取嵌入向量缓存文件路径
 * @param {string} sessionId
 * @returns {string}
 */
function getEmbeddingCachePath(sessionId) {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(MEMORY_DIR, `${safeId}-embeddings.json`);
}

/**
 * 获取嵌入向量缓存文件路径
 * @param {string} sessionId
 * @returns {string}
 */
function getEmbeddingCachePath(sessionId) {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(MEMORY_DIR, `${safeId}-embeddings.json`);
}

/**
 * 加载嵌入向量缓存（从磁盘）
 * @param {string} sessionId
 * @returns {Object} { roundId: embedding }
 */
function loadEmbeddingCache(sessionId) {
  const cachePath = getEmbeddingCachePath(sessionId);
  
  if (fs.existsSync(cachePath)) {
    try {
      return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    } catch (e) {
      console.warn('[DialogueMemory] 加载嵌入向量缓存失败:', e.message);
    }
  }
  
  return {};
}

/**
 * 保存嵌入向量缓存（到磁盘）
 * @param {string} sessionId
 * @param {Object} cache - { roundId: embedding }
 */
function saveEmbeddingCache(sessionId, cache) {
  const cachePath = getEmbeddingCachePath(sessionId);
  
  try {
    fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), 'utf8');
  } catch (e) {
    console.error('[DialogueMemory] 保存嵌入向量缓存失败:', e.message);
  }
}

/**
 * 调用bge-m3获取嵌入向量（带缓存）
 * @param {string} text - 输入文本
 * @returns {Promise<Array<number>>} 嵌入向量
 */
async function getEmbedding(text) {
  // 检查缓存
  if (embeddingCache.has(text)) {
    return embeddingCache.get(text);
  }
  
  // 调用API
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: getBgeModel(),
      prompt: text
    });

    const options = {
      ...getBgeConn(),
      path: '/api/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.embedding) {
            // 存入缓存
            embeddingCache.set(text, result.embedding);
            
            // 清理过期缓存（简单策略：超过限制时全清）
            if (embeddingCache.size > CACHE_SIZE_LIMIT) {
              embeddingCache.clear();
            }
            
            resolve(result.embedding);
          } else {
            reject(new Error('No embedding in response: ' + body));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.write(data);
    req.end();
  });
}

/**
 * 计算余弦相似度
 * @param {Array<number>} vec1
 * @param {Array<number>} vec2
 * @returns {number} 相似度（0-1）
 */
function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// 确保存储目录存在（启动时执行一次）
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// ============ 工具函数 ============

/**
 * 智能的中文关键词提取（使用nodejieba分词）
 * @param {string} text - 输入文本
 * @returns {Array<string>} 关键词列表
 */
function extractKeywords(text) {
  if (!text || typeof text !== 'string') return [];
  
  try {
    // 使用nodejieba进行中文分词
    const words = jieba.cut(text, true); // true = 精确模式
    
    // 过滤：长度>=2、不在停用词表中
    const filtered = words.filter(word => {
      if (word.length < 2) return false;
      if (STOP_WORDS.has(word)) return false;
      return true;
    });
    
    // 去重
    return [...new Set(filtered)];
  } catch (err) {
    console.error('[DialogueMemory] 分词失败，降级为简单分词:', err.message);
    // 降级处理：使用简单的按字符分割
    const chars = [];
    for (let i = 0; i < text.length - 1; i++) {
      const bigram = text.slice(i, i + 2);
      if (!STOP_WORDS.has(bigram)) {
        chars.push(bigram);
      }
    }
    return [...new Set(chars)];
  }
}

/**
 * 计算两个关键词集合的重叠度
 * @param {Array<string>} keywords1
 * @param {Array<string>} keywords2
 * @returns {number} 重叠词数量
 */
function calculateOverlap(keywords1, keywords2) {
  if (!keywords1 || !keywords2 || keywords1.length === 0 || keywords2.length === 0) {
    return 0;
  }
  
  const set1 = new Set(keywords1);
  const set2 = new Set(keywords2);
  
  let overlap = 0;
  for (const k of set1) {
    if (set2.has(k)) overlap++;
  }
  
  return overlap;
}

/**
 * @typedef {Object} ConversationRound
 * @property {string} roundId   - 轮次ID（格式：{sessionId}_{序号}）
 * @property {number} timestamp   - 时间戳（ms）
 * @property {string} userQuery   - 用户本轮提问
 * @property {string} aiResponse   - AI 本轮回复
 * @property {Object|null} intent  - 意图对象（同 IntentResult.primaryIntent）
 * @property {Array} entities     - 实体列表 [{ type, value, confidence }]
 * @property {Array} [topics]    - 本轮话题标签（可选）
 */

/**
 * @typedef {Object} ContextInfo
 * @property {Array} recentRounds  - 最近轮次（截断后）
 * @property {Array} keyEntities   - 高频关键实体
 * @property {Array} topicChain    - 话题链
 * @property {Object} coreferences - 指代消解映射表
 */

// ============ 内存缓存层（性能优化：减少磁盘 IO）============
/** @type {Map<string, { history: Array, mtime: number }>} */
const memoryCache = new Map();
const CACHE_TTL = 5000; // 缓存有效期 5 秒（高频读写场景下有效）

/** @type {Map<string, { history: Array, mtime: number }>} */
const userMemoryCache = new Map(); // 用户记忆缓存（按userId）

/**
 * 读取会话历史（带内存缓存）
 * @param {string} sessionId
 * @returns {Array<ConversationRound>}
 */
function readHistory(sessionId) {
  const filePath = getFilePath(sessionId);
  if (!fs.existsSync(filePath)) return [];

  try {
    const stat = fs.statSync(filePath);
    const cached = memoryCache.get(sessionId);

    // 缓存命中且文件未修改 → 直接返回
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.history;
    }

    const history = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    memoryCache.set(sessionId, { history, mtime: stat.mtimeMs });

    // 定期清理过期缓存（简单策略：超过 100 条时全清）
    if (memoryCache.size > 100) {
      memoryCache.clear();
    }

    return Array.isArray(history) ? history : [];
  } catch (err) {
    console.error('[DialogueMemory] 读取历史失败:', err.message);
    return [];
  }
}

/**
 * 写入会话历史（更新缓存）
 * @param {string} sessionId
 * @param {Array} history
 */
function writeHistory(sessionId, history) {
  const filePath = getFilePath(sessionId);
  const data = JSON.stringify(history, null, 2);
  fs.writeFileSync(filePath, data, 'utf8');

  // 同步更新缓存
  try {
    const stat = fs.statSync(filePath);
    memoryCache.set(sessionId, { history, mtime: stat.mtimeMs });
  } catch (e) {
    // 写入后立刻 stat 一般不会失败，失败则清除缓存
    memoryCache.delete(sessionId);
  }
}

/**
 * 读取用户记忆（带内存缓存）
 * @param {string} userId - 用户ID（格式：user_xxx）
 * @returns {Array<ConversationRound>}
 */
function readUserMemory(userId) {
  const filePath = getUserMemoryPath(userId);
  if (!fs.existsSync(filePath)) return [];

  try {
    const stat = fs.statSync(filePath);
    const cached = userMemoryCache.get(userId);

    // 缓存命中且文件未修改 → 直接返回
    if (cached && cached.mtime === stat.mtimeMs) {
      return cached.history;
    }

    const history = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    
    // 限制缓存大小（LRU策略）
    if (userMemoryCache.size > CACHE_SIZE_LIMIT) {
      const firstKey = userMemoryCache.keys().next().value;
      userMemoryCache.delete(firstKey);
    }

    userMemoryCache.set(userId, { history, mtime: stat.mtimeMs });
    return Array.isArray(history) ? history : [];

  } catch (err) {
    console.error('[DialogueMemory] 读取用户记忆失败:', err.message);
    return [];
  }
}

/**
 * 写入用户记忆（更新缓存）
 * @param {string} userId - 用户ID（格式：user_xxx）
 * @param {Array} history
 */
function writeUserMemory(userId, history) {
  const filePath = getUserMemoryPath(userId);
  const data = JSON.stringify(history, null, 2);
  fs.writeFileSync(filePath, data, 'utf8');

  // 同步更新缓存
  try {
    const stat = fs.statSync(filePath);
    userMemoryCache.set(userId, { history, mtime: stat.mtimeMs });
  } catch (e) {
    userMemoryCache.delete(userId);
  }
}

/**
 * 获取文件路径（统一路径构造，防止路径遍历）
 * @param {string} id - sessionId 或 userId（userId格式：user_xxx）
 * @returns {string}
 */
function getFilePath(id) {
  // 只允许字母、数字、下划线、短横线（防止路径遍历攻击）
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(MEMORY_DIR, `${safeId}.json`);
}

/**
 * 获取用户记忆文件路径（按userId存储）
 * @param {string} userId - 用户ID（格式：user_xxx）
 * @returns {string}
 */
function getUserMemoryPath(userId) {
  // userId格式：user_xxx，直接使用userId作为文件名
  const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
  return path.join(MEMORY_DIR, `${safeId}.json`);
}

// ============ 核心 API ============

/**
 * 存储对话轮次
 * @param {string} sessionId  - 会话ID（非空字符串）
 * @param {Object} round     - 轮次数据 { userQuery, aiResponse, intent, entities, topics }
 * @param {string} [userId]  - 用户ID（可选，格式：user_xxx）
 * @returns {{ success: boolean, totalRounds: number, roundId: string, error?: string }}
 */
function storeConversationRound(sessionId, round, userId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { success: false, error: 'sessionId 无效' };
  }
  if (!round || typeof round.userQuery !== 'string') {
    return { success: false, error: 'round.userQuery 缺失或类型错误' };
  }

  try {
    // 1. 存储到 sessionId 对应的文件（向后兼容）
    const history = readHistory(sessionId);
    
    const roundWithId = {
      roundId: `${sessionId}_${history.length + 1}`,
      timestamp: round.timestamp || Date.now(),
      userQuery: round.userQuery.slice(0, 2000),   // 防止异常长输入
      aiResponse: (round.aiResponse || '').slice(0, 2000),
      intent: round.intent || null,
      entities: Array.isArray(round.entities) ? round.entities.slice(0, 50) : [],
      topics: Array.isArray(round.topics) ? round.topics : [],
      sessionId: sessionId,  // 记录所属的 sessionId
      userId: userId || null  // 记录所属的用户ID
    };

    history.push(roundWithId);

    // 限制历史长度（保留最近 N 轮）
    if (history.length > MAX_HISTORY_ROUNDS) {
      const removed = history.splice(0, history.length - MAX_HISTORY_ROUNDS);
      // 清除被截断部分的缓存（如果存在）
      removed.forEach(r => { /* no per-round cache */ });
    }

    writeHistory(sessionId, history);

    console.log(`[DialogueMemory] 存储成功：sessionId=${sessionId}, roundId=${roundWithId.roundId}`);
    
    // 2. 如果传入了 userId，同时存储到用户记忆文件
    if (userId && typeof userId === 'string' && userId.startsWith('user_')) {
      const userHistory = readUserMemory(userId);
      userHistory.push(roundWithId);
      
      // 限制用户记忆长度
      if (userHistory.length > MAX_HISTORY_ROUNDS * 2) {  // 用户记忆保留更多轮次
        userHistory.splice(0, userHistory.length - MAX_HISTORY_ROUNDS * 2);
      }
      
      writeUserMemory(userId, userHistory);
      console.log(`[DialogueMemory] 同时存储到用户记忆：userId=${userId}`);
    }
    
    // 异步预计算嵌入向量（不阻塞主流程）
    precomputeEmbedding(sessionId, roundWithId).catch(err => {
      console.warn('[DialogueMemory] 预计算嵌入向量失败:', err.message);
    });
    
    return { success: true, totalRounds: history.length, roundId: roundWithId.roundId };

  } catch (err) {
    console.error('[DialogueMemory] 存储失败：', err);
    return { success: false, error: err.message };
  }
}

/**
 * 获取对话历史
 * @param {string} sessionId       - 会话ID
 * @param {number} [limit=0]      - 返回最近 N 轮（0=全部）
 * @param {boolean} [includeContext=false] - 是否构建上下文增强信息
 * @param {string} [userId]       - 用户ID（可选，格式：user_xxx）
 * @returns {{ success: boolean, history: Array, context: (ContextInfo|null), error?: string }}
 */
function getConversationHistory(sessionId, limit = 0, includeContext = false, userId) {
  // 如果传入了 userId，优先从用户记忆文件读取
  if (userId && typeof userId === 'string' && userId.startsWith('user_')) {
    try {
      let history = readUserMemory(userId);

      // 限制返回轮次
      if (Number.isInteger(limit) && limit > 0 && history.length > limit) {
        history = history.slice(-limit);
      }

      let context = null;
      if (includeContext && history.length > 0) {
        context = buildContextFromHistory(history);
      }

      return { success: true, history, context };
    } catch (err) {
      console.error('[DialogueMemory] 从用户记忆读取失败，回退到sessionId:', err.message);
      // 回退到 sessionId
    }
  }

  // 按 sessionId 读取（向后兼容）
  if (!sessionId || typeof sessionId !== 'string') {
    return { success: false, history: [], context: null, error: 'sessionId 无效' };
  }

  try {
    const filePath = getFilePath(sessionId);
    if (!fs.existsSync(filePath)) {
      return { success: true, history: [], context: null };
    }

    let history = readHistory(sessionId);

    // 限制返回轮次
    if (Number.isInteger(limit) && limit > 0 && history.length > limit) {
      history = history.slice(-limit);
    }

    let context = null;
    if (includeContext && history.length > 0) {
      context = buildContextFromHistory(history);
    }

    return { success: true, history, context };

  } catch (err) {
    console.error('[DialogueMemory] 读取历史失败：', err);
    return { success: false, history: [], context: null, error: err.message };
  }
}

/**
 * 从对话历史构建上下文增强信息
 * @param {Array<ConversationRound>} history
 * @returns {ContextInfo}
 */
function buildContextFromHistory(history) {
  const recentRounds = history.slice(-MAX_CONTEXT_LENGTH);

  // 统计实体频率（使用 Map 提升性能）
  const entityCount = new Map();
  for (const round of history) {
    if (Array.isArray(round.entities)) {
      for (const e of round.entities) {
        if (e && typeof e.value === 'string') {
          const key = `${e.type || 'unknown'}:${e.value}`;
          entityCount.set(key, (entityCount.get(key) || 0) + 1);
        }
      }
    }
  }

  const keyEntities = [...entityCount.entries()]
    .filter(([_, count]) => count > ENTITY_FREQ_THRESHOLD)
    .map(([key, count]) => {
      const idx = key.indexOf(':');
      return { type: key.slice(0, idx), value: key.slice(idx + 1), frequency: count };
    })
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, MAX_KEY_ENTITIES);

  // 构建话题链（只包含有意图的轮次）
  const topicChain = [];
  for (const r of history) {
    if (r.intent && r.intent.primaryIntent) {
      topicChain.push({
        roundId: r.roundId,
        timestamp: r.timestamp,
        intent: r.intent.primaryIntent,
        entities: r.entities
      });
    }
  }

  // 指代消解映射
  const coreferences = buildCoreferenceMapping(recentRounds);

  return {
    recentRounds: recentRounds.map(r => ({
      roundId: r.roundId,
      userQuery: r.userQuery,
      aiResponse: r.aiResponse.slice(0, 100),
      intent: r.intent,
      entities: r.entities
    })),
    keyEntities,
    topicChain,
    coreferences
  };
}

/**
 * 构建指代消解映射（规则实现）
 * @param {Array} recentRounds - 最近轮次
 * @returns {Object} { "它": "报销政策", "这个方法": "在线报销系统" }
 */
function buildCoreferenceMapping(recentRounds) {
  const mapping = {};
  const recentEntities = [];

  // 从最近轮次中提取实体（去重，最多保留 MAX_COREFERENCE_ENTITIES 个）
  for (let i = recentRounds.length - 1; i >= 0 && recentEntities.length < MAX_COREFERENCE_ENTITIES; i--) {
    const round = recentRounds[i];
    if (!Array.isArray(round.entities)) continue;
    for (const e of round.entities) {
      if (e && e.value && !recentEntities.some(re => re.value === e.value)) {
        recentEntities.push(e);
      }
    }
  }

  if (recentEntities.length > 0) {
    mapping['它'] = recentEntities[0].value;
    mapping['这个'] = recentEntities[0].value;

    if (recentEntities.length > 1) {
      mapping['那个'] = recentEntities[1].value;
    }

    if (recentEntities.length > 1) {
      mapping['这些'] = recentEntities.slice(0, 3).map(e => e.value).join('、');
    }
  }

  return mapping;
}

/**
 * 增强用户查询（指代消解 + 上下文补全）
 * @param {string} currentQuery - 当前用户查询
 * @param {string} sessionId    - 会话ID
 * @returns {Promise<Object>} { enhancedQuery, originalQuery, usedHistory, coreferences, context }
 */
async function enhanceQueryWithMemory(currentQuery, sessionId) {
  if (!currentQuery || !sessionId) {
    return { enhancedQuery: currentQuery || '', usedHistory: [], coreferences: {}, context: null };
  }

  try {
    const { success, history, context } = getConversationHistory(sessionId, MAX_CONTEXT_LENGTH, true);

    if (!success || !history || history.length === 0) {
      return { enhancedQuery: currentQuery, originalQuery: currentQuery, usedHistory: [], coreferences: {}, context: null };
    }

    // 1. 指代消解：替换指代词
    let enhancedQuery = currentQuery;
    const coreferences = context ? context.coreferences : {};

    for (const [pronoun, entity] of Object.entries(coreferences)) {
      if (enhancedQuery.includes(pronoun)) {
        enhancedQuery = enhancedQuery.replaceAll(pronoun, entity);
      }
    }

    // 2. 智能选择相关历史轮次
    const relevantHistory = await selectRelevantHistory(currentQuery, enhancedQuery, history, sessionId);

    // 3. 构建上下文增强的查询（用于RAG检索）
    let finalEnhancedQuery = enhancedQuery;
    
    if (relevantHistory.length > 0) {
      const contextParts = [];
      
      // 构建上下文前缀（限制长度，避免过长）
      for (const h of relevantHistory) {
        contextParts.push(`Q: ${h.userQuery}`);
        
        // AI回答摘要（取前150字）
        const answerSummary = h.aiResponse && h.aiResponse.length > 150 
          ? h.aiResponse.slice(0, 150) + '...' 
          : (h.aiResponse || '');
        
        if (answerSummary) {
          contextParts.push(`A: ${answerSummary}`);
        }
      }
      
      // 将上下文添加到查询中（作为前缀）
      const contextPrefix = contextParts.join('\n');
      finalEnhancedQuery = `【对话上下文】\n${contextPrefix}\n\n【当前问题】\n${enhancedQuery}`;
    }

    return {
      enhancedQuery: finalEnhancedQuery,
      originalQuery: currentQuery,
      usedHistory: relevantHistory,
      coreferences,
      context: context ? {
        keyEntities: context.keyEntities,
        topicChain: context.topicChain.slice(-5)
      } : null
    };

  } catch (err) {
    console.error('[DialogueMemory] 查询增强失败：', err);
    return { enhancedQuery: currentQuery, originalQuery: currentQuery, usedHistory: [], coreferences: {}, context: null, error: err.message };
  }
}

/**
 * 智能选择与当前查询相关的历史轮次
 * 策略：
 *   1. 如果包含指代词（它、这个、那个等），必须注入最近2-3轮
 *   2. 基于语义相似度选择相关历史（使用bge-m3）
 *   3. 如果语义相似度计算失败，降级为关键词重叠度
 *   4. 如果没有相关历史，返回空数组（不注入不相关的历史）
 * @param {string} originalQuery - 原始查询（未做指代消解）
 * @param {string} enhancedQuery - 增强后的查询（已做指代消解）
 * @param {Array} history - 对话历史
 * @returns {Promise<Array>} 相关历史轮次（最多3条）
 */
async function selectRelevantHistory(originalQuery, enhancedQuery, history, sessionId = null) {
  if (!history || history.length === 0) return [];
  
  // 策略1：检查是否包含指代词
  const hasCoreference = /[它他她这个那这些那些]/.test(originalQuery);
  
  if (hasCoreference) {
    // 必须注入最近2-3轮
    console.log('[DialogueMemory] 检测到指代词，注入最近3轮对话');
    return history.slice(-3);
  }
  
  // 策略2：基于语义相似度选择
  try {
    const queryEmbedding = await getEmbedding(enhancedQuery);
    
    // 加载磁盘缓存（如果提供了sessionId）
    let diskCache = {};
    if (sessionId) {
      diskCache = loadEmbeddingCache(sessionId);
    }
    
    const scoredHistory = [];
    for (const round of history) {
      try {
        let roundEmbedding = null;
        
        // 优先从内存缓存读取
        if (embeddingCache.has(round.roundId)) {
          roundEmbedding = embeddingCache.get(round.roundId);
        }
        // 其次从磁盘缓存读取
        else if (diskCache[round.roundId]) {
          roundEmbedding = diskCache[round.roundId];
          // 存入内存缓存
          embeddingCache.set(round.roundId, roundEmbedding);
        }
        // 实时计算
        else {
          const roundText = round.userQuery + ' ' + (round.aiResponse || '');
          roundEmbedding = await getEmbedding(roundText);
          
          // 存入内存缓存
          embeddingCache.set(round.roundId, roundEmbedding);
          
          // 异步存入磁盘缓存（不阻塞）
          if (sessionId) {
            setImmediate(() => {
              try {
                const cache = loadEmbeddingCache(sessionId);
                cache[round.roundId] = roundEmbedding;
                saveEmbeddingCache(sessionId, cache);
              } catch (e) {
                console.warn('[DialogueMemory] 异步存储嵌入向量缓存失败:', e.message);
              }
            });
          }
        }
        
        const similarity = cosineSimilarity(queryEmbedding, roundEmbedding);
          
        if (similarity >= SIMILARITY_THRESHOLD) {
          scoredHistory.push({ round, score: similarity });
        }
      } catch (err) {
        console.warn('[DialogueMemory] 计算轮次相似度失败，跳过:', err.message);
      }
    }
    
    // 按相似度排序，返回前3条
    if (scoredHistory.length > 0) {
      const relevant = scoredHistory
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(item => item.round);
      
      console.log(`[DialogueMemory] 基于语义相似度选择 ${relevant.length} 轮历史`);
      return relevant;
    }
  } catch (err) {
    console.warn('[DialogueMemory] 语义相似度计算失败，降级为关键词匹配:', err.message);
  }
  
  // 策略3：降级为关键词重叠度（原有逻辑）
  const currentKeywords = extractKeywords(enhancedQuery);
  
  if (currentKeywords.length === 0) {
    // 查询没有有意义的关键词，返回空数组（不注入历史）
    console.log('[DialogueMemory] 查询没有有意义的关键词，不注入历史');
    return [];
  }
  
  const scoredHistory = history.map(round => {
    const roundKeywords = extractKeywords(round.userQuery);
    const overlap = calculateOverlap(currentKeywords, roundKeywords);
    
    return { round, score: overlap };
  });
  
  // 返回得分>0的前3条
  const relevant = scoredHistory
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(item => item.round);
  
  // 策略4：如果没有相关历史，返回空数组（不注入不相关的历史）
  if (relevant.length === 0) {
    console.log('[DialogueMemory] 没有找到相关的历史轮次，不注入历史');
    return [];
  }
  
  return relevant;
}

/**
 * 查找与当前查询相关的历史轮次（公开API，内部调用selectRelevantHistory）
 * @param {string} query      - 当前查询
 * @param {Array} history    - 对话历史
 * @param {string} [sessionId] - 会话ID（可选，用于加载磁盘缓存）
 * @returns {Array} 相关历史轮次（最多5条）
 */
function findRelevantHistory(query, history, sessionId = null) {
  const relevant = selectRelevantHistory(query, query, history, sessionId);
  
  // 格式化为前端展示格式
  return relevant.map(r => ({
    roundId: r.roundId,
    userQuery: r.userQuery,
    aiResponse: r.aiResponse ? r.aiResponse.slice(0, 200) : '',
    intent: r.intent
  }));
}

/**
 * 清除对话历史
 * @param {string|null} [sessionId=null] - 会话ID（null=清除所有）
 * @param {string} [userId=null]      - 用户ID（可选，格式：user_xxx）
 * @returns {{ success: boolean, message: string, error?: string }}
 */
function clearConversationHistory(sessionId = null, userId = null) {
  try {
    // 如果传入了 userId，清除用户记忆
    if (userId && typeof userId === 'string' && userId.startsWith('user_')) {
      const userFilePath = getUserMemoryPath(userId);
      if (fs.existsSync(userFilePath)) {
        fs.unlinkSync(userFilePath);
        userMemoryCache.delete(userId);
      }
      return { success: true, message: `用户 ${userId} 的记忆已清除` };
    }

    if (sessionId) {
      const filePath = getFilePath(sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        memoryCache.delete(sessionId);
      }
      return { success: true, message: `会话 ${sessionId} 的历史已清除` };
    } else {
      // 清除所有会话
      const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json'));
      let count = 0;
      for (const file of files) {
        fs.unlinkSync(path.join(MEMORY_DIR, file));
        count++;
      }
      memoryCache.clear();
      userMemoryCache.clear();
      return { success: true, message: `已清除 ${count} 个会话的历史` };
    }
  } catch (err) {
    console.error('[DialogueMemory] 清除历史失败：', err);
    return { success: false, error: err.message };
  }
}

/**
 * 获取会话统计信息（适配管理后台前端展示）
 * @returns {{ success: boolean, total_memories: number, active_sessions: number, hit_rate: number, user_memories: Object, memory_types: Object, sessions: Array, error?: string }}
 */
function getMemoryStats() {
  try {
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.json') && !f.includes('-embeddings'));
    const sessions = [];
    const now = Date.now();
    const ACTIVE_THRESHOLD = 24 * 60 * 60 * 1000; // 24小时内的会话算活跃
    const userMemories = {};  // 按用户(userId)分组统计记忆数
    const memoryTypes = {};   // 按意图类型统计

    // 分离用户记忆文件和会话文件
    const userFiles = files.filter(f => f.startsWith('user_'));
    const sessionFiles = files.filter(f => !f.startsWith('user_'));

    // 优先统计用户记忆文件
    for (const file of userFiles) {
      const userId = file.replace('.json', '');
      const filePath = path.join(MEMORY_DIR, file);

      try {
        const stat = fs.statSync(filePath);
        const history = readUserMemory(userId);
        const roundCount = history.length;

        // 统计用户记忆
        if (roundCount > 0) {
          userMemories[userId] = roundCount;
        }

        // 统计记忆类型（按intent分布）
        for (const round of history) {
          if (round.intent) {
            const type = round.intent;
            memoryTypes[type] = (memoryTypes[type] || 0) + 1;
          }
        }

        sessions.push({
          sessionId: userId,  // 使用userId作为标识
          totalRounds: roundCount,
          lastUpdated: stat.mtime.toISOString(),
          latestQuery: roundCount > 0 ? history[roundCount - 1].userQuery : '',
          isActive: (now - stat.mtimeMs) < ACTIVE_THRESHOLD
        });
      } catch (e) {
        console.warn(`[DialogueMemory] 读取用户记忆 ${userId} 失败，跳过:`, e.message);
      }
    }

    // 如果没有用户记忆文件，则统计会话文件（向后兼容）
    if (userFiles.length === 0) {
      for (const file of sessionFiles) {
        const sessionId = file.replace('.json', '');
        const filePath = path.join(MEMORY_DIR, file);

        try {
          const stat = fs.statSync(filePath);
          const history = readHistory(sessionId);
          const roundCount = history.length;

          // 统计用户记忆（用sessionId作为用户标识）
          if (roundCount > 0) {
            userMemories[sessionId] = roundCount;
          }

          // 统计记忆类型（按intent分布）
          for (const round of history) {
            if (round.intent) {
              const type = round.intent;
              memoryTypes[type] = (memoryTypes[type] || 0) + 1;
            }
          }

          sessions.push({
            sessionId,
            totalRounds: roundCount,
            lastUpdated: stat.mtime.toISOString(),
            latestQuery: roundCount > 0 ? history[roundCount - 1].userQuery : '',
            isActive: (now - stat.mtimeMs) < ACTIVE_THRESHOLD
          });
        } catch (e) {
          console.warn(`[DialogueMemory] 读取会话 ${sessionId} 失败，跳过:`, e.message);
        }
      }
    }

    const totalMemories = sessions.reduce((sum, s) => sum + s.totalRounds, 0);
    const activeSessions = sessions.filter(s => s.isActive).length;

    return {
      success: true,
      total_memories: totalMemories,
      active_sessions: activeSessions,
      hit_rate: 0,  // TODO: 需要记录记忆命中次数来计算命中率
      user_memories: userMemories,
      memory_types: memoryTypes,
      sessions: sessions.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated))
    };

  } catch (err) {
    console.error('[DialogueMemory] 获取统计失败：', err);
    return { success: false, error: err.message };
  }
}

module.exports = {
  storeConversationRound,
  getConversationHistory,
  enhanceQueryWithMemory,
  clearConversationHistory,
  getMemoryStats,
  buildContextFromHistory
};
