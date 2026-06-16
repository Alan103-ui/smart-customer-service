// 智能意图理解模块（极简版）

const { callOllamaJSON, DEFAULT_BASE_URL, DEFAULT_MODEL } = require('./ollama-client');

const OLLAMA_BASE_URL = DEFAULT_BASE_URL;
const OLLAMA_MODEL = DEFAULT_MODEL;

const INTENT_TAXONOMY = {
  level1: ['query', 'process', 'complaint', 'suggestion', 'greeting'],
  level2: {
    query: ['policy', 'operation', 'data', 'contact'],
    process: ['apply', 'approve', 'execute', 'query_status'],
    complaint: ['quality', 'delay', 'service', 'other'],
    suggestion: ['improve', 'new_feature', 'optimization'],
    greeting: ['hello', 'thanks', 'goodbye', 'other']
  }
};

// 主函数
async function understandIntent(userQuery, context, retryCount = 0) {
  if (!userQuery || typeof userQuery !== 'string') {
    return fallbackIntent('');
  }
  
  const query = userQuery.trim();
  if (query.length === 0) {
    return fallbackIntent('');
  }
  
  // 规则引擎：快速匹配（避免LLM调用）
  const ruleResult = quickRuleCheck(query);
  if (ruleResult) {
    console.log('[Intent] Rule engine matched:', ruleResult.primaryIntent);
    return ruleResult;
  }
  
  try {
    const prompt = buildPrompt(query);
    const parsed = await callOllamaJSON(prompt, {
      baseURL: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
      temperature: 0.1,
      max_tokens: 500,
      timeout: 90000  // 90秒超时（优化：从60秒增加到90秒）
    });
    
    // 验证返回结果
    if (parsed && parsed.primaryIntent && parsed.primaryIntent.level1) {
      // 验证level1是否合法
      if (INTENT_TAXONOMY.level1.includes(parsed.primaryIntent.level1)) {
        return parsed;
      } else {
        console.warn('[Intent] Invalid level1:', parsed.primaryIntent.level1);
      }
    }
    
    // 解析失败或验证失败，重试
    throw new Error('Invalid LLM response');
  } catch (err) {
    console.error(`[Intent] Error (attempt ${retryCount + 1}/3):`, err.message);
    
    // 重试机制：最多重试3次
    if (retryCount < 2) {
      console.log(`[Intent] Retrying... (${retryCount + 2}/3)`);
      await sleep(1000 * (retryCount + 1));  // 指数退避：1s, 2s, 3s
      return await understandIntent(userQuery, context, retryCount + 1);
    }
    
    // 重试失败，使用降级方案
    console.warn('[Intent] All retries failed, using fallback');
    return fallbackIntent(query);
  }
}

// 辅助函数：睡眠
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 规则引擎：快速匹配常见问题
function quickRuleCheck(query) {
  const q = query.toLowerCase();
  
  // 规则1：问候语（高置信度）
  if (q.includes('你好') || q.includes('您好') || q.includes('hi') || q.includes('hello')) {
    return { primaryIntent: { level1: 'greeting', level2: 'hello', confidence: 0.98 }, entities: [] };
  }
  if (q.includes('谢谢') || q.includes('感谢') || q.includes('thanks')) {
    return { primaryIntent: { level1: 'greeting', level2: 'thanks', confidence: 0.98 }, entities: [] };
  }
  if (q.includes('再见') || q.includes('拜拜') || q.includes('bye')) {
    return { primaryIntent: { level1: 'greeting', level2: 'goodbye', confidence: 0.98 }, entities: [] };
  }
  
  // 规则2：投诉（高置信度）
  if (q.includes('投诉') || q.includes('举报') || q.includes('不满意') || q.includes('太差')) {
    return { primaryIntent: { level1: 'complaint', level2: 'service', confidence: 0.95 }, entities: [] };
  }
  
  // 规则3：申请/流程（高置信度）
  if (q.includes('如何申请') || q.includes('怎么申请') || q.includes('申请流程')) {
    return { primaryIntent: { level1: 'process', level2: 'apply', confidence: 0.95 }, entities: [{ type: 'process', value: '申请', confidence: 0.9 }] };
  }
  if (q.includes('报销') && (q.includes('流程') || q.includes('如何') || q.includes('怎么'))) {
    return { primaryIntent: { level1: 'process', level2: 'apply', confidence: 0.95 }, entities: [{ type: 'policy', value: '报销', confidence: 0.95 }] };
  }
  
  // 规则4：查询进度（中置信度）
  if (q.includes('进度') || q.includes('状态') || q.includes('查一下')) {
    return { primaryIntent: { level1: 'process', level2: 'query_status', confidence: 0.9 }, entities: [] };
  }
  
  // 没有匹配规则，需要LLM
  return null;
}

// 构建Prompt（优化版 - 使用英文避免编码问题，增加few-shot示例）
function buildPrompt(query) {
  let prompt = 'You are an intent understanding expert for enterprise customer service.\n\n';
  prompt += 'User query: ' + query + '\n\n';
  prompt += 'Task: Analyze the user query and return a JSON object with intent classification.\n\n';
  prompt += 'Intent taxonomy (MUST use these exact values):\n';
  prompt += '1. level1 (primary category): query, process, complaint, suggestion, greeting\n';
  prompt += '2. level2 (subcategory):\n';
  prompt += '   - For query: policy, operation, data, contact\n';
  prompt += '   - For process: apply, approve, execute, query_status\n';
  prompt += '   - For complaint: quality, delay, service, other\n';
  prompt += '   - For suggestion: improve, new_feature, optimization\n';
  prompt += '   - For greeting: hello, thanks, goodbye, other\n\n';
  prompt += 'IMPORTANT RULES:\n';
  prompt += '1. Return ONLY the JSON object, NO other text\n';
  prompt += '2. Use double quotes for all keys and string values\n';
  prompt += '3. confidence must be a number between 0.0 and 1.0\n';
  prompt += '4. entities is an array, can be empty []\n\n';
  prompt += 'Return JSON format:\n';
  prompt += '{"primaryIntent":{"level1":"query","level2":"policy","confidence":0.9},"entities":[{"type":"policy","value":"报销","confidence":0.95}]}\n\n';
  prompt += 'Examples (VERY IMPORTANT - Learn from these):\n';
  prompt += 'Query: "如何申请报销"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"process","level2":"apply","confidence":0.95},"entities":[{"type":"process","value":"报销","confidence":0.9}]}\n\n';
  prompt += 'Query: "报销流程是什么"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"process","level2":"apply","confidence":0.9},"entities":[{"type":"policy","value":"报销流程","confidence":0.85}]}\n\n';
  prompt += 'Query: "投诉服务太差"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"complaint","level2":"service","confidence":0.95},"entities":[]}\n\n';
  prompt += 'Query: "你好"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"greeting","level2":"hello","confidence":0.98},"entities":[]}\n\n';
  prompt += 'Query: "谢谢"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"greeting","level2":"thanks","confidence":0.98},"entities":[]}\n\n';
  prompt += 'Query: "查询订单状态"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"process","level2":"query_status","confidence":0.9},"entities":[{"type":"data","value":"订单状态","confidence":0.9}]}\n\n';
  prompt += 'Query: "建议优化系统"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"suggestion","level2":"improve","confidence":0.9},"entities":[]}\n\n';
  prompt += 'Query: "建议增加微信支付"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"suggestion","level2":"new_feature","confidence":0.95},"entities":[{"type":"feature","value":"微信支付","confidence":0.9}]}\n\n';
  prompt += 'Query: "客服电话是多少"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"query","level2":"contact","confidence":0.95},"entities":[{"type":"contact","value":"客服电话","confidence":0.95}]}\n\n';
  prompt += 'Query: "系统太慢了"\n';
  prompt += 'Output: {"primaryIntent":{"level1":"complaint","level2":"service","confidence":0.9},"entities":[]}\n';
  return prompt;
}

// 降级方案
function fallbackIntent(query) {
  const q = query.toLowerCase();
  
  if (q.includes('complaint') || q.includes('bad') || q.includes('投诉')) {
    return { primaryIntent: { level1: 'complaint', level2: 'service', confidence: 0.8 } };
  }
  if (q.includes('hello') || q.includes('hi') || q.includes('你好')) {
    return { primaryIntent: { level1: 'greeting', level2: 'hello', confidence: 0.98 } };
  }
  if (q.includes('thank') || q.includes('thanks') || q.includes('谢谢')) {
    return { primaryIntent: { level1: 'greeting', level2: 'thanks', confidence: 0.98 } };
  }
  
  return { primaryIntent: { level1: 'query', level2: null, confidence: 0.5 } };
}

// 批量理解
async function batchUnderstandIntents(queries) {
  const results = [];
  for (const q of queries) {
    const result = await understandIntent(q);
    results.push(result);
  }
  return results;
}

module.exports = {
  understandIntent,
  batchUnderstandIntents,
  fallbackIntent,
  INTENT_TAXONOMY
};
