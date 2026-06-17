/**
 * RAG 向量存储模块（优化版 - 混合检索）
 * - 嵌入模型：bge-m3（中文友好）
 * - 支持 Rerank 重排序（bge-reranker-v2-m3 或 LLM fallback）
 * - FAQ 分块策略：问题块 + 答案块 + 关键词块
 * - 新增：BM25 关键词检索 + RRF 融合（混合检索）
 */

const fs = require('fs');
const path = require('path');

const OLLAMA_HOST = '172.17.6.18';
const OLLAMA_PORT = 11434;
const EMBEDDING_MODEL = 'bge-m3:latest';           // 中文嵌入模型
const RERANK_MODEL = 'bge-reranker-v2-m3';  // 重排序模型（可选）
const VECTOR_STORE_PATH = path.join(__dirname, '../data/vector-store.json');
const RERANK_PATH = path.join(__dirname, '../data/rerank-cache.json');

// ============ 缓存系统（加速RAG搜索） ============

// FAQ 级别 embedding 缓存：预计算所有 FAQ 问题的 embedding，避免每次查询都调用 Ollama
const FAQ_EMBEDDING_CACHE = new Map(); // key: parentDocId, value: { question, embedding, category, keywords }

// 查询 embedding LRU 缓存：避免相同查询重复调用 Ollama
const QUERY_EMBEDDING_CACHE = new Map();
const QUERY_CACHE_MAX_SIZE = 50;

// ============ BM25 关键词检索（混合检索用） ============
/**
 * BM25 参数
 */
const BM25_K1 = 1.5;
const BM25_B = 0.75;

// BM25 索引：{ term: { df: number, postings: { docId: { tf: number, length: number } } }
let BM25_INDEX = null;
let BM25_DOC_COUNT = 0;
let BM25_AVGDL = 0;

/**
 * 中文+英文分词（简单版）
 */
function tokenize(text) {
  if (!text) return [];
  const tokens = [];
  // 中文字符：按单字或2字分词
  const chinese = text.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const word of chinese) {
    // 单字
    for (let i = 0; i < word.length; i++) {
      tokens.push(word[i]);
    }
    // 2-gram
    for (let i = 0; i < word.length - 1; i++) {
      tokens.push(word.slice(i, i + 2));
    }
  }
  // 英文和数字
  const english = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const w of english) {
    if (w.length >= 2) tokens.push(w);
  }
  return [...new Set(tokens)]; // 去重
}

/**
 * 构建 BM25 索引（从 FAQ 数据）
 */
function buildBM25Index() {
  try {
    const faqList = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/faq.json'), 'utf8'));
    BM25_INDEX = {};
    BM25_DOC_COUNT = faqList.length;
    let totalLen = 0;

    for (const faq of faqList) {
      const docId = faq.id;
      const text = `${faq.question} ${faq.answer} ${(faq.keywords || []).join(' ')}`;
      const tokens = tokenize(text);
      totalLen += tokens.length;

      const tfMap = {};
      for (const t of tokens) {
        tfMap[t] = (tfMap[t] || 0) + 1;
      }

      for (const [term, tf] of Object.entries(tfMap)) {
        if (!BM25_INDEX[term]) BM25_INDEX[term] = { df: 0, postings: {} };
        if (!BM25_INDEX[term].postings[docId]) {
          BM25_INDEX[term].df += 1;
        }
        BM25_INDEX[term].postings[docId] = { tf, length: tokens.length };
      }
    }

    BM25_AVGDL = BM25_DOC_COUNT > 0 ? totalLen / BM25_DOC_COUNT : 0;
    console.log(`[BM25] 索引构建完成: ${Object.keys(BM25_INDEX).length} 个词, ${BM25_DOC_COUNT} 个文档`);
  } catch (e) {
    console.error('[BM25] 索引构建失败:', e.message);
    BM25_INDEX = {};
  }
}

/**
 * BM25 搜索
 * @param {string} query - 查询文本
 * @param {number} topK - 返回数量
 * @param {number} threshold - 分数阈值
 * @returns {Array} - [{docId, score}]
 */
function bm25Search(query, topK = 5, threshold = 0) {
  if (!BM25_INDEX) {
    buildBM25Index();
  }

  const queryTokens = tokenize(query);
  const scores = {};

  for (const term of queryTokens) {
    const inv = BM25_INDEX[term];
    if (!inv) continue;
    const idf = Math.log((BM25_DOC_COUNT - inv.df + 0.5) / (inv.df + 0.5) + 1);

    for (const [docId, { tf, length }] of Object.entries(inv.postings)) {
      const numerator = tf * (BM25_K1 + 1);
      const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (length / BM25_AVGDL));
      const score = idf * (numerator / denominator);
      scores[docId] = (scores[docId] || 0) + score;
    }
  }

  const results = Object.entries(scores)
    .map(([docId, score]) => ({ docId, score }))
    .filter(r => r.score >= threshold)
    .sort((a, b) => b.score - a.score);

  console.log(`[BM25] 搜索: "${query.slice(0, 30)}...", 命中: ${results.length} 条, top=${results[0]?.score?.toFixed(2) || 'N/A'}`);
  return results.slice(0, topK);
}

// ============ RRF 融合（Reciprocal Rank Fusion） ============
/**
 * RRF 融合多个排序结果
 * @param {Array<Array>} rankLists - 多个排序列表, 每个元素为 [{docId, score}]
 * @param {number} k - RRF 常数（默认 60）
 * @returns {Array} - 融合后的排序结果 [{docId, score, rrScores}]
 */
function rrfFusion(rankLists, k = 60) {
  const scores = {};
  const details = {};

  for (let i = 0; i < rankLists.length; i++) {
    const list = rankLists[i];
    for (let j = 0; j < list.length; j++) {
      const docId = list[j].docId || list[j].parentDocId;
      if (!docId) continue;
      if (!scores[docId]) {
        scores[docId] = 0;
        details[docId] = [];
      }
      scores[docId] += 1 / (k + j + 1);
      details[docId].push({ source: i, rank: j + 1, score: list[j].score });
    }
  }

  return Object.entries(scores)
    .map(([docId, score]) => ({
      docId,
      score,
      rrScores: details[docId]
    }))
    .sort((a, b) => b.score - a.score);
}

// ============ 缓存系统（加速RAG搜索） ============

/**
 * 构建 FAQ embedding 缓存（启动时或 FAQ 变更时调用）
 * 从向量库中提取所有 FAQ 的 question chunk 的 embedding
 */
function buildFAQEmbeddingCache() {
  const store = loadStore();
  FAQ_EMBEDDING_CACHE.clear();

  // 按 parentDocId 分组，优先取 keyword 或 qa 类型的 chunk
  const docMap = new Map();
  for (const chunk of store.chunks) {
    if (!chunk.parentDocId || !chunk.parentDocId.startsWith('faq_')) continue;
    if (!docMap.has(chunk.parentDocId)) {
      docMap.set(chunk.parentDocId, []);
    }
    docMap.get(chunk.parentDocId).push(chunk);
  }

  for (const [docId, chunks] of docMap) {
    // 优先取 keyword 类型（包含完整问题+关键词），其次 qa 类型
    let bestChunk = chunks.find(c => c.chunkType === 'keyword')
                 || chunks.find(c => c.chunkType === 'qa')
                 || chunks[0];
    if (bestChunk && bestChunk.embedding) {
      FAQ_EMBEDDING_CACHE.set(docId, {
        question: bestChunk.title || '',
        embedding: bestChunk.embedding,
        category: bestChunk.category || '',
        content: bestChunk.content || ''
      });
    }
  }

  console.log(`[VectorStore] FAQ embedding 缓存构建完成: ${FAQ_EMBEDDING_CACHE.size} 条`);
  return FAQ_EMBEDDING_CACHE.size;
}

/**
 * 基于 FAQ 缓存的快速搜索（无需调用 Ollama，纯内存计算）
 * @param {string} query - 查询文本
 * @param {number} topK - 返回数量
 * @param {number} threshold - 相似度阈值
 * @returns {Array} - 排序后的候选 [{parentDocId, score, question, category}]
 */
function searchByFAQCache(query, topK = 5, threshold = 0.15) {
  if (FAQ_EMBEDDING_CACHE.size === 0) {
    console.warn('[VectorStore] FAQ 缓存为空，请先调用 buildFAQEmbeddingCache()');
    return [];
  }

  // 使用缓存的查询 embedding（避免重复调用 Ollama）
  const cacheKey = query.slice(0, 200);
  let queryEmbedding = QUERY_EMBEDDING_CACHE.get(cacheKey);

  if (!queryEmbedding) {
    // 没有缓存，需要异步获取（此函数为同步，返回空，由调用方处理）
    return null; // 标记需要异步获取
  }

  // 纯内存计算：与所有 FAQ embedding 做余弦相似度
  const results = [];
  for (const [docId, faq] of FAQ_EMBEDDING_CACHE) {
    const score = cosineSimilarity(queryEmbedding, faq.embedding);
    if (score >= threshold) {
      results.push({
        parentDocId: docId,
        score,
        question: faq.question,
        category: faq.category,
        content: faq.content
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

/**
 * 异步版本：基于 FAQ 缓存的搜索（会自动获取 embedding 并缓存）
 * 优化版：使用混合检索（BM25 + 向量）
 */
async function searchByFAQCacheAsync(query, topK = 5, threshold = 0.15, useHybrid = true) {
  const cacheKey = query.slice(0, 200);
  let queryEmbedding = QUERY_EMBEDDING_CACHE.get(cacheKey);

  if (!queryEmbedding) {
    const start = Date.now();
    queryEmbedding = await getEmbedding(query);
    const cost = Date.now() - start;
    console.log(`[VectorStore] 查询 embedding 生成耗时: ${cost}ms`);

    // LRU 缓存
    if (QUERY_EMBEDDING_CACHE.size >= QUERY_CACHE_MAX_SIZE) {
      const firstKey = QUERY_EMBEDDING_CACHE.keys().next().value;
      QUERY_EMBEDDING_CACHE.delete(firstKey);
    }
    QUERY_EMBEDDING_CACHE.set(cacheKey, queryEmbedding);
  } else {
    console.log(`[VectorStore] 查询 embedding 命中缓存`);
  }

  if (FAQ_EMBEDDING_CACHE.size === 0) buildFAQEmbeddingCache();

  // 混合检索：BM25 + 向量
  if (useHybrid) {
    const vectorResults = [];
    for (const [docId, faq] of FAQ_EMBEDDING_CACHE) {
      const score = cosineSimilarity(queryEmbedding, faq.embedding);
      if (score >= threshold) {
        vectorResults.push({
          docId,
          score,
          question: faq.question,
          category: faq.category,
          content: faq.content
        });
      }
    }
    vectorResults.sort((a, b) => b.score - a.score);

    const bm25Results = bm25Search(query, topK * 2, 0);

    // RRF 融合
    const fused = rrfFusion([vectorResults, bm25Results], 60);
    
    // 转换回原格式
    const finalResults = [];
    for (const r of fused) {
      const faq = FAQ_EMBEDDING_CACHE.get(r.docId);
      if (faq) {
        finalResults.push({
          parentDocId: r.docId,
          score: r.score,
          question: faq.question,
          category: faq.category,
          content: faq.content,
          rrScores: r.rrScores
        });
      }
    }

    console.log(`[VectorStore] 混合搜索: ${finalResults.length} 条命中, top=${(finalResults[0]?.score * 100)?.toFixed(1) || 'N/A'}%`);
    return finalResults.slice(0, topK);
  } else {
    // 仅向量搜索
    const results = [];
    for (const [docId, faq] of FAQ_EMBEDDING_CACHE) {
      const score = cosineSimilarity(queryEmbedding, faq.embedding);
      if (score >= threshold) {
        results.push({
          parentDocId: docId,
          score,
          question: faq.question,
          category: faq.category,
          content: faq.content
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    console.log(`[VectorStore] FAQ 缓存搜索: ${results.length} 条命中, top=${(results[0]?.score * 100)?.toFixed(1) || 'N/A'}%`);
    return results.slice(0, topK);
  }
}

// ============ 嵌入向量生成（带查询缓存） ============
function getEmbedding(text) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const payload = JSON.stringify({ model: EMBEDDING_MODEL, prompt: text.slice(0, 8000) });
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.embedding && Array.isArray(parsed.embedding)) {
            resolve(parsed.embedding);
          } else {
            // 模型不存在时 fallback 到 qwen2.5:14b
            getEmbeddingFallback(text).then(resolve).catch(reject);
          }
        } catch (e) {
          reject(new Error('解析嵌入响应失败: ' + e.message));
        }
      });
    });
    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('嵌入API超时')); });
    req.write(payload);
    req.end();
  });
}

// Fallback：用 qwen2.5:14b 生成嵌入（兼容旧环境）
function getEmbeddingFallback(text) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    const payload = JSON.stringify({ model: 'qwen2.5:14b', prompt: text.slice(0, 8000) });
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/embeddings',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 60000
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.embedding) resolve(parsed.embedding);
          else reject(new Error('Fallback嵌入失败: ' + data.slice(0, 200)));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Fallback嵌入超时')); });
    req.write(payload);
    req.end();
  });
}

// ============ Rerank 重排序 ============
// 调用独立部署的 bge-reranker-v2-m3 服务 (172.17.6.18:8000)，失败则降级为软重排序
async function rerankResults(query, candidates, topN = 5) {
  if (candidates.length <= 1) return candidates;

  // 方案A：调用独立 rerank API 服务
  try {
    const http = require('http');
    const documents = candidates.map(c => c.content || c.title || '');
    const payload = JSON.stringify({ query, documents });
    const options = {
      hostname: '172.17.6.18',
      port: 8000,
      path: '/rerank',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30000
    };
    return new Promise((resolve) => {
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.results && Array.isArray(parsed.results)) {
              // 通过 document 内容匹配回原始候选（独立服务返回格式：{document, score}）
              const docMap = new Map();
              candidates.forEach((c, idx) => docMap.set(c.content || c.title || '', idx));
              const reranked = parsed.results
                .map(r => {
                  const idx = docMap.get(r.document);
                  if (idx === undefined) return null;
                  // 用 sigmoid 将原始分数映射到 0-1 范围
                  const rawScore = r.score || 0;
                  const normScore = 1 / (1 + Math.exp(-rawScore));
                  return { ...candidates[idx], rerankScore: normScore };
                })
                .filter(Boolean)
                .sort((a, b) => (b.rerankScore || 0) - (a.rerankScore || 0));
              console.log(`[Rerank] ${candidates.length}→${reranked.length} 条（模型重排序）`);
              resolve(reranked);
            } else {
              throw new Error('rerank响应格式异常');
            }
          } catch (e) {
            console.warn('[Rerank] 模型重排序失败，改用软重排序:', e.message);
            resolve(softRerank(query, candidates, topN));
          }
        });
      });
      req.on('error', (err) => { console.warn('[Rerank] 连接失败:', err.message); resolve(softRerank(query, candidates, topN)); });
      req.on('timeout', () => { req.destroy(); console.warn('[Rerank] 请求超时，改用软重排序'); resolve(softRerank(query, candidates, topN)); });
      req.write(payload);
      req.end();
    });
  } catch (e) {
    return softRerank(query, candidates, topN);
  }
}

// 软重排序：结合语义相似度 + 关键词重叠 + 答案质量
function softRerank(query, candidates, topN = 5) {
  const q = query.toLowerCase();
  const scored = candidates.map(c => {
    let score = c.score || 0;
    const content = (c.content || c.title || '').toLowerCase();
    // 关键词重叠加分
    const words = q.split(/\s+/).filter(w => w.length >= 2);
    let overlap = 0;
    for (const w of words) {
      if (content.includes(w)) overlap++;
    }
    score += overlap * 0.05;
    // 答案长度适中加分（太短可能信息不足）
    const answerLen = (c.content || '').length;
    if (answerLen > 50 && answerLen < 500) score += 0.03;
    return { ...c, rerankScore: Math.min(score, 1.0) };
  });
  const result = scored.sort((a, b) => b.rerankScore - a.rerankScore).slice(0, topN);
  console.log(`[Rerank] 软重排序完成，${candidates.length}→${result.length} 条`);
  return result;
}

// ============ 余弦相似度 ============
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ============ 向量存储读写 ============
function loadStore() {
  if (!fs.existsSync(VECTOR_STORE_PATH)) return { chunks: [], meta: { version: 2, updatedAt: null } };
  try {
    return JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, 'utf8'));
  } catch (e) {
    console.error('[VectorStore] 读取失败:', e.message);
    return { chunks: [], meta: { version: 2, updatedAt: null } };
  }
}

function saveStore(store) {
  store.meta.updatedAt = new Date().toISOString();
  const dir = path.dirname(VECTOR_STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VECTOR_STORE_PATH, JSON.stringify(store, null, 2));
}

// ============ 文本分块（改进版）============
function splitIntoChunks(text, maxLen = 400, overlap = 80) {
  const chunks = [];
  // 先按段落分
  const paragraphs = text.split(/\n{1,}/).filter(p => p.trim().length > 20);
  let current = '';
  for (const para of paragraphs) {
    if ((current + para).length > maxLen && current.length > 0) {
      chunks.push(current.trim());
      current = current.slice(-overlap) + '\n' + para;
    } else {
      current += (current ? '\n' : '') + para;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  // 段落太少时按长度强制分块
  if (chunks.length <= 1 && text.length > maxLen) {
    chunks.length = 0;
    for (let i = 0; i < text.length; i += maxLen - overlap) {
      chunks.push(text.slice(i, i + maxLen).trim());
    }
  }
  return chunks.filter(c => c.length > 20);
}

// ============ 公开 API ============

/**
 * 添加文档分块（升级版：为每条FAQ创建多种分块）
 */
async function addDocumentChunks(docId, title, content, answer, keywords, category, metadata = {}) {
  const store = loadStore();
  // 去重：删除该FAQ的所有旧分块
  store.chunks = store.chunks.filter(c => c.parentDocId !== docId);

  const allChunks = [];

  // 分块1：问题 + 答案（完整上下文）
  const fullText = `问题：${title}\n答案：${answer}`;
  const fullChunks = splitIntoChunks(fullText, 500, 100);
  for (let i = 0; i < fullChunks.length; i++) {
    allChunks.push({
      chunkType: 'qa',
      text: fullChunks[i],
      parentDocId: docId,
      title: title,
      category: category,
      chunkIndex: i
    });
  }

  // 分块2：关键词扩展块（提升关键词匹配召回率）
  if (keywords && keywords.length > 0) {
    const keywordText = `问题：${title}\n关键词：${keywords.join('、')}\n答案：${answer}`;
    allChunks.push({
      chunkType: 'keyword',
      text: keywordText,
      parentDocId: docId,
      title: title,
      category: category,
      chunkIndex: allChunks.length
    });
  }

  // 分块3：答案单独分块（用户直接问答案内容时召回）
  if (answer && answer.length > 30) {
    const answerChunks = splitIntoChunks(answer, 400, 80);
    for (let i = 0; i < answerChunks.length; i++) {
      allChunks.push({
        chunkType: 'answer',
        text: `问题参考：${title}\n${answerChunks[i]}`,
        parentDocId: docId,
        title: title,
        category: category,
        chunkIndex: allChunks.length + i
      });
    }
  }

  console.log(`[VectorStore] ${title}: 共 ${allChunks.length} 个分块（qa=${fullChunks.length}, keyword=${keywords?.length > 0 ? 1 : 0}, answer=${answer.length > 30 ? Math.ceil(answer.length / 400) : 0}）`);

  // 批量生成嵌入向量
  for (let i = 0; i < allChunks.length; i++) {
    try {
      const embedding = await getEmbedding(allChunks[i].text);
      store.chunks.push({
        docId: `${docId}_chunk_${allChunks[i].chunkIndex}`,
        parentDocId: docId,
        title: allChunks[i].title,
        category: allChunks[i].category,
        chunkType: allChunks[i].chunkType,
        content: allChunks[i].text,
        embedding,
        metadata,
        createdAt: new Date().toISOString()
      });
      // 避免请求过快
      if (i < allChunks.length - 1) await new Promise(r => setTimeout(r, 80));
    } catch (e) {
      console.error(`[VectorStore] 分块 ${i} 向量化失败:`, e.message);
    }
  }

  saveStore(store);
  console.log(`[VectorStore] ${title} 完成，当前共 ${store.chunks.length} 条`);
  
  // 重建 BM25 索引
  buildBM25Index();
  
  return { success: true, chunkCount: allChunks.length };
}

/**
 * 语义搜索（升级版：初筛 + rerank）
 * @param {string} query - 用户问题
 * @param {number} topK - 最终返回条数
 * @param {number} threshold - 初筛相似度阈值
 * @param {boolean} useRerank - 是否启用重排序
 * @param {boolean} useHybrid - 是否使用混合检索（BM25 + 向量）
 */
async function semanticSearch(query, topK = 5, threshold = 0.15, useRerank = true, useHybrid = true) {
  const store = loadStore();
  if (store.chunks.length === 0) return [];

  console.log(`[VectorStore] 语义搜索: "${query.slice(0, 50)}...", 库共${store.chunks.length}条, threshold=${threshold}, hybrid=${useHybrid}`);

  // 混合检索模式
  if (useHybrid) {
    const queryEmbedding = await getEmbedding(query);
    
    // 向量搜索
    let vectorResults = store.chunks.map(c => ({
      ...c,
      score: cosineSimilarity(queryEmbedding, c.embedding)
    }))
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score);

    // BM25 搜索
    const bm25Results = bm25Search(query, topK * 3, 0);

    // RRF 融合
    const vectorRankList = vectorResults.slice(0, topK * 3).map((r, idx) => ({ docId: r.parentDocId || r.docId, score: r.score }));
    const bm25RankList = bm25Results.map((r, idx) => ({ docId: r.docId, score: r.score }));

    const fused = rrfFusion([vectorRankList, bm25RankList], 60);
    
    // 取 topK 个融合结果，然后从 store 中取出完整信息
    const topDocIds = new Set(fused.slice(0, topK).map(r => r.docId));
    let results = [];
    for (const docId of topDocIds) {
      const bestChunk = store.chunks
        .filter(c => (c.parentDocId || c.docId) === docId)
        .sort((a, b) => cosineSimilarity(queryEmbedding, b.embedding) - cosineSimilarity(queryEmbedding, a.embedding))[0];
      if (bestChunk) results.push(bestChunk);
    }

    console.log(`[VectorStore] 混合搜索最终结果: ${results.length} 条`);
    return results.slice(0, topK);
  } else {
    // 仅向量搜索（原逻辑）
    const queryEmbedding = await getEmbedding(query);

    // 第一遍：余弦相似度初筛（扩大候选范围）
    let results = store.chunks.map(c => ({
      ...c,
      score: cosineSimilarity(queryEmbedding, c.embedding)
    }))
      .filter(r => r.score >= threshold)
      .sort((a, b) => b.score - a.score);

    console.log(`[VectorStore] 初筛: ${results.length} 条, top=${results[0]?.score?.toFixed(4) || 'N/A'}`);

    if (results.length === 0) return [];

    // 第二遍：Rerank 重排序（取 top-15 做 rerank，输出 topK）
    if (useRerank && results.length > 1) {
      const rerankCandidates = results.slice(0, Math.max(topK * 3, 10));
      results = await rerankResults(query, rerankCandidates, topK);
    } else {
      results = results.slice(0, topK);
    }

    console.log(`[VectorStore] 最终结果: ${results.length} 条`);
    return results;
  }
}

/**
 * 重建向量库（升级版）
 */
async function rebuildVectorStore() {
  const FAQ_PATH = path.join(__dirname, '../data/faq.json');
  let count = 0;
  let totalChunks = 0;

  // 清空
  saveStore({
    chunks: [],
    meta: {
      version: 2,
      updatedAt: null,
      rebuiltAt: new Date().toISOString(),
      embeddingModel: EMBEDDING_MODEL
    }
  });

  // 向量化 FAQ
  if (fs.existsSync(FAQ_PATH)) {
    const faqList = JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8'));
    console.log(`[VectorStore] 开始重建，共 ${faqList.length} 条 FAQ`);

    for (const f of faqList) {
      try {
        const result = await addDocumentChunks(
          f.id,
          f.question,
          f.question, // content（保留兼容）
          f.answer || '',
          f.keywords || [],
          f.category || '',
          { category: f.category, source: 'faq' }
        );
        count++;
        totalChunks += result.chunkCount || 0;
      } catch (e) {
        console.error(`[VectorStore] FAQ向量化失败 ${f.id}:`, e.message);
      }
    }
  }

  // 向量化上传文档（如果有）
  const UPLOAD_DIR = path.join(__dirname, '../data/uploads');
  if (fs.existsSync(UPLOAD_DIR)) {
    const files = fs.readdirSync(UPLOAD_DIR).filter(f => f.endsWith('.txt') || f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(UPLOAD_DIR, file), 'utf8');
        const chunks = splitIntoChunks(content);
        const store = loadStore();
        for (let i = 0; i < chunks.length; i++) {
          const embedding = await getEmbedding(chunks[i]);
          store.chunks.push({
            docId: `upload_${file}_chunk_${i}`,
            parentDocId: `upload_${file}`,
            title: file,
            category: '知识库文档',
            chunkType: 'document',
            content: chunks[i],
            embedding,
            metadata: { source: 'upload', filename: file },
            chunkIndex: i,
            createdAt: new Date().toISOString()
          });
          if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 80));
        }
        saveStore(store);
        count++;
        totalChunks += chunks.length;
      } catch (e) {
        console.error(`[VectorStore] 文档向量化失败 ${file}:`, e.message);
      }
    }
  }

  const stats = getStats();
  console.log(`[VectorStore] 重建完成: ${count} 个文档, ${stats.totalChunks} 个分块`);
  
  // 重建 BM25 索引
  buildBM25Index();
  
  return { success: true, documentCount: count, totalChunks: stats.totalChunks };
}

/**
 * 删除文档向量
 */
function deleteDocument(docId) {
  const store = loadStore();
  const before = store.chunks.length;
  store.chunks = store.chunks.filter(c => c.docId !== docId && c.parentDocId !== docId);
  saveStore(store);
  console.log(`[VectorStore] 删除 ${docId}, ${before}->${store.chunks.length}`);
  
  // 重建 BM25 索引
  buildBM25Index();
  
  return { success: true };
}

/**
 * 获取向量库统计
 */
function getStats() {
  const store = loadStore();
  const chunkTypes = {};
  store.chunks.forEach(c => {
    const t = c.chunkType || 'unknown';
    chunkTypes[t] = (chunkTypes[t] || 0) + 1;
  });
  return {
    totalChunks: store.chunks.length,
    uniqueDocs: [...new Set(store.chunks.map(c => c.parentDocId || c.docId))].length,
    updatedAt: store.meta.updatedAt,
    embeddingModel: store.meta.embeddingModel || 'unknown',
    chunkTypes
  };
}

/**
 * 增量更新单条 FAQ（修改后调用）
 */
async function updateFAQVector(faqItem) {
  await addDocumentChunks(
    faqItem.id,
    faqItem.question,
    faqItem.question,
    faqItem.answer || '',
    faqItem.keywords || [],
    faqItem.category || '',
    { category: faqItem.category, source: 'faq' }
  );
  
  // 重建 BM25 索引
  buildBM25Index();
  
  return { success: true };
}

module.exports = {
  semanticSearch,
  rebuildVectorStore,
  deleteDocument,
  getStats,
  getEmbedding,
  updateFAQVector,
  addDocumentChunks,
  buildFAQEmbeddingCache,
  searchByFAQCacheAsync,
  loadStore,
  cosineSimilarity,
  // 新增：混合检索相关
  bm25Search,
  buildBM25Index,
  rrfFusion
};
