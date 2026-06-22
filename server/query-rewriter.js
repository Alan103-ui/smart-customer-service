/**
 * 查询改写模块（Query Rewriting + HyDE）
 * 功能：
 * 1. 短查询改写（如"报销" → "如何申请费用报销？"）
 * 2. 代词消解（"它多少钱？" → "XX产品多少钱？"）
 * 3. HyDE（假设文档生成，用假设答案的向量去检索）
 */

const { callOllamaChat, callOllamaGenerate } = require('./ollama-client');

// ============ 1. 查询改写 ============

/**
 * 改写查询（短查询扩展 + 代词消解）
 * @param {string} query - 原始查询
 * @param {Array} history - 对话历史 [{role, content}]
 * @param {string} context - 额外上下文（如用户当前浏览的页面）
 * @returns {Promise<{original, rewritten, isRewritten}>}
 */
async function rewriteQuery(query, history = [], context = '') {
  const original = query.trim();
  
  // 如果查询已经很长（>=10个字），不改写
  if (original.length >= 10) {
    return { original, rewritten: original, isRewritten: false };
  }
  
  console.log(`[QueryRewrite] 检测短查询: "${original}" (${original.length}字)`);
  
  // 构造对话历史文本
  let historyText = '';
  if (history && history.length > 0) {
    const recentHistory = history.slice(-3); // 只取最近3轮
    historyText = recentHistory.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`).join('\n');
  }
  
  // Prompt：让LLM改写查询
  const prompt = `你是企业智能客服系统。用户的查询可能很短或有歧义，请根据上下文改写成完整、清晰的问题。

${historyText ? `对话历史：\n${historyText}\n` : ''}${context ? `上下文：${context}\n` : ''}用户原始查询："${original}"

要求：
1. 如果查询很短（如"报销"、"付款"），推测用户可能想问的完整问题
2. 如果有代词（"它"、"这个"、"那个"），根据上下文替换为具体对象
3. 保持问题的原意，不要过度解释
4. 只返回改写后的问题，不要有任何解释或额外文字

改写后的问题：`;

  try {
    const rewritten = await callOllamaGenerate(prompt, 100);
    const cleaned = rewritten.trim().replace(/^改写后的问题：?/i, '').replace(/^["'']|["'']$/g, '').trim();
    
    // 如果改写失败或改写后为空，返回原查询
    if (!cleaned || cleaned === original) {
      console.log(`[QueryRewrite] 无需改写: "${original}"`);
      return { original, rewritten: original, isRewritten: false };
    }
    
    console.log(`[QueryRewrite] 改写成功: "${original}" → "${cleaned}"`);
    return { original, rewritten: cleaned, isRewritten: true };
  } catch (e) {
    console.warn('[QueryRewrite] 改写失败，使用原查询:', e.message);
    return { original, rewritten: original, isRewritten: false };
  }
}

/**
 * 批量改写查询（用于评估或批量处理）
 * @param {Array<string>} queries - 查询列表
 * @returns {Promise<Array<{original, rewritten, isRewritten}>>}
 */
async function batchRewriteQueries(queries, history = []) {
  const results = [];
  for (const query of queries) {
    const result = await rewriteQuery(query, history);
    results.push(result);
  }
  return results;
}

// ============ 2. HyDE（假设文档生成） ============

/**
 * HyDE：生成假设答案，再用假设答案的向量去检索
 * 论文：Precise Zero-Shot Dense Retrieval without Relevance Labels (NeurIPS 2022)
 * 
 * 原理：
 * 1. 用LLM根据查询生成一个假设的答案（即使不准确，但语义相近）
 * 2. 用这个假设答案的向量去检索（而不是用原查询的向量）
 * 3. 因为假设答案和真实文档的风格更相近，检索效果更好
 * 
 * @param {string} query - 用户查询
 * @param {number} maxLength - 假设答案的最大长度（字）
 * @returns {Promise<{hypoAnswer, hypoEmbedding, originalQuery}>}
 */
async function generateHypotheticalAnswer(query, maxLength = 150) {
  console.log(`[HyDE] 生成假设答案: "${query.slice(0, 30)}..."`);
  
  const prompt = `请根据以下问题，生成一个可能的答案（即使不完全准确，但要语义相关）。

问题：${query}

要求：
1. 答案要详细、专业，包含相关关键词
2. 长度控制在${maxLength}字以内
3. 不要说"我不知道"或"可能"，直接给出答案
4. 只返回答案内容，不要有任何解释

答案：`;

  try {
    const startTime = Date.now();
    const hypoAnswer = await callOllamaGenerate(prompt, maxLength + 50);
    const cleaned = hypoAnswer.trim();
    
    if (!cleaned) {
      console.warn('[HyDE] 假设答案为空，跳过HyDE');
      return { hypoAnswer: null, hypoEmbedding: null, originalQuery: query };
    }
    
    const cost = Date.now() - startTime;
    console.log(`[HyDE] 假设答案生成完成(${cost}ms): "${cleaned.slice(0, 50)}..."`);
    
    return { hypoAnswer: cleaned, hypoEmbedding: null, originalQuery: query };
  } catch (e) {
    console.warn('[HyDE] 假设答案生成失败:', e.message);
    return { hypoAnswer: null, hypoEmbedding: null, originalQuery: query };
  }
}

/**
 * HyDE搜索：用假设答案的向量去检索
 * @param {string} query - 原始查询
 * @param {Function} getEmbedding - 获取向量的函数
 * @param {Function} searchFn - 搜索函数（接收向量，返回结果）
 * @param {number} topK - 返回数量
 * @returns {Promise<Array>} - 检索结果
 */
async function hydeSearch(query, getEmbedding, searchFn, topK = 5) {
  console.log(`[HyDE] 开始HyDE搜索: "${query.slice(0, 30)}..."`);
  
  // 步骤1：生成假设答案
  const { hypoAnswer } = await generateHypotheticalAnswer(query);
  
  if (!hypoAnswer) {
    console.warn('[HyDE] 假设答案生成失败，降级为常规搜索');
    // 降级：用原查询搜索
    const queryEmbedding = await getEmbedding(query);
    return await searchFn(queryEmbedding, topK);
  }
  
  // 步骤2：获取假设答案的向量
  const startTime = Date.now();
  const hypoEmbedding = await getEmbedding(hypoAnswer);
  const embedCost = Date.now() - startTime;
  console.log(`[HyDE] 假设答案向量生成完成(${embedCost}ms)`);
  
  // 步骤3：用假设答案的向量去检索
  const searchStartTime = Date.now();
  const results = await searchFn(hypoEmbedding, topK);
  const searchCost = Date.now() - searchStartTime;
  console.log(`[HyDE] 搜索完成(${searchCost}ms), 命中${results.length}条`);
  
  return results;
}

// ============ 3. 查询扩展（同义词 + 相关词） ============

/**
 * 查询扩展：为查询添加同义词和相关词（提升召回率）
 * @param {string} query - 原始查询
 * @param {Object} synonymMap - 同义词映射（可选，默认使用vector-store.js中的SYNONYM_MAP）
 * @returns {Promise<{original, expanded, terms}>}
 */
async function expandQuery(query, synonymMap = null) {
  // 使用内置的同义词映射（可以从vector-store.js导入SYNONYM_MAP）
  const defaultSynonymMap = {
    '报销': ['费用报销', '报账', '报销流程', '报销申请'],
    '付款': ['支付', '打款', '转账', '付款申请'],
    '供应商': ['供货商', '卖方', '提供方'],
    '客户': ['顾客', '买受人', '买方'],
    '采购': ['购买', '买', '采购申请'],
    '合同': ['协议', '合约'],
    '发票': ['发票', '票据', '收据'],
    '预算': ['预算控制', '经费'],
    '审核': ['审批', '批准'],
    '借款': ['预支', '暂支', '备用金']
  };
  
  const synMap = synonymMap || defaultSynonymMap;
  
  const terms = new Set([query]);
  
  // 添加同义词
  for (const [standard, synonyms] of Object.entries(synMap)) {
    if (query.includes(standard)) {
      synonyms.forEach(s => terms.add(s));
    }
    for (const syn of synonyms) {
      if (query.includes(syn)) {
        terms.add(standard);
        synonyms.forEach(s => terms.add(s));
      }
    }
  }
  
  const expanded = [...terms].join(' ');
  
  console.log(`[QueryExpand] 扩展查询: "${query}" → "${expanded}" (${terms.size}个词)`);
  
  return { original: query, expanded, terms: [...terms] };
}

// ============ 4. 综合查询优化（改写 + 扩展 + HyDE） ============

/**
 * 综合查询优化：改写 + 扩展 + HyDE（可选）
 * @param {string} query - 原始查询
 * @param {Object} options - 配置选项
 * @param {boolean} options.useRewrite - 是否使用查询改写（默认true）
 * @param {boolean} options.useExpansion - 是否使用查询扩展（默认true）
 * @param {boolean} options.useHyDE - 是否使用HyDE（默认false，因为会增加延迟）
 * @param {Array} history - 对话历史
 * @returns {Promise<{optimizedQuery, originalQuery, techniquesUsed}>}
 */
async function optimizeQuery(query, options = {}, history = []) {
  const { useRewrite = true, useExpansion = true, useHyDE = false } = options;
  const techniquesUsed = [];
  let optimizedQuery = query;
  
  // 步骤1：查询改写（短查询扩展 + 代词消解）
  if (useRewrite) {
    const { rewritten, isRewritten } = await rewriteQuery(query, history);
    if (isRewritten) {
      optimizedQuery = rewritten;
      techniquesUsed.push('rewrite');
    }
  }
  
  // 步骤2：查询扩展（同义词）
  if (useExpansion) {
    const { expanded, terms } = await expandQuery(optimizedQuery);
    if (expanded !== optimizedQuery) {
      optimizedQuery = expanded;
      techniquesUsed.push('expansion');
    }
  }
  
  // 步骤3：HyDE（假设文档生成）- 可选，因为会增加延迟
  let hydeAnswer = null;
  if (useHyDE) {
    const { hypoAnswer } = await generateHypotheticalAnswer(optimizedQuery);
    if (hypoAnswer) {
      hydeAnswer = hypoAnswer;
      techniquesUsed.push('hyde');
    }
  }
  
  console.log(`[QueryOptimize] 优化完成: "${query}" → "${optimizedQuery}" (使用: ${techniquesUsed.join(', ')})`);
  
  return {
    optimizedQuery,
    originalQuery: query,
    techniquesUsed,
    hydeAnswer
  };
}

// ============ 导出 ============
module.exports = {
  rewriteQuery,
  batchRewriteQueries,
  generateHypotheticalAnswer,
  hydeSearch,
  expandQuery,
  optimizeQuery
};
