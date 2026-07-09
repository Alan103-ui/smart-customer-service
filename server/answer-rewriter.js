/**
 * LLM 智能改写答案模块
 * 功能：口语化改写、语气调节、个性化表达、情感化添加
 */

const { callOllamaChat, DEFAULT_BASE_URL, DEFAULT_MODEL } = require('./ollama-client');
const { loadSoftwareInfo } = require('./data');

// ============ 配置常量 ============
const OLLAMA_BASE_URL = DEFAULT_BASE_URL;
const OLLAMA_MODEL = DEFAULT_MODEL;

// ============ 改写结果缓存 ============
// 按 FAQ id + 模型版本 + 语气 缓存，二次命中直接返回，省掉 LLM 调用延迟
const rewriteCache = new Map(); // key -> { answerHash, rewritten, hits }
const REWRITE_CACHE_MAX_SIZE = 500;

/**
 * 获取当前实际用于改写的 LLM 模型（用于缓存版本标识）。
 * 模型切换后，缓存 key 变化，旧结果自动失效。
 * 懒加载 model-switcher，避免模块加载期循环依赖。
 */
function getActiveRewriteModel() {
  try {
    const ms = require('./model-switcher');
    const m = ms.getCurrentModel ? ms.getCurrentModel('llm') : null;
    return m || OLLAMA_MODEL;
  } catch (e) {
    return OLLAMA_MODEL;
  }
}

/** 轻量哈希（仅用于内容失效判断，非加密用途） */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function buildRewriteCacheKey(faqId, model, tone) {
  return `${faqId}::${model}::${tone}`;
}

/**
 * 清除改写缓存（可指定 faqId 精准清除，或不传清空全部）
 * @param {string} [faqId]
 * @returns {number} 清除条数
 */
function clearRewriteCache(faqId) {
  if (!faqId) {
    const n = rewriteCache.size;
    rewriteCache.clear();
    console.log(`[AnswerRewriter] 改写缓存已清空（${n} 条）`);
    return n;
  }
  let removed = 0;
  for (const key of rewriteCache.keys()) {
    if (key.startsWith(`${faqId}::`)) {
      rewriteCache.delete(key);
      removed++;
    }
  }
  console.log(`[AnswerRewriter] 已清除 FAQ(${faqId}) 的改写缓存 ${removed} 条`);
  return removed;
}

function getRewriteCacheStats() {
  return { size: rewriteCache.size, maxSize: REWRITE_CACHE_MAX_SIZE };
}

/** 最大改写长度限制（防止异常输入） */
const MAX_ANSWER_LENGTH = 5000;
const MAX_USER_MESSAGE_LENGTH = 1000;

/** 改写后处理：需要清除的前缀列表 */
const CLEANUP_PREFIXES = [
  /^["'"「]|["'"」]$/gm,
  /^(回复|改写结果|答案|标准答案)[：:\s]*/i
];

// ============ 语气配置 ============
const TONE_CONFIGS = {
  professional: {
    name: '专业',
    description: '正式、严谨、信息完整',
    prompt: '请用专业、正式的语气回复，信息完整，条理清晰。使用"您"称呼用户。'
  },
  friendly: {
    name: '亲切',
    description: '温和、友好、像朋友一样',
    prompt: '请用亲切、友好的语气回复，像朋友一样温和耐心。可以使用"你"称呼用户，适当添加表情符号😊。'
  },
  concise: {
    name: '简洁',
    description: '简短、直接、不啰嗦',
    prompt: '请用简洁、直接的语气回复，控制在1-2句话内，直接给出核心信息。'
  },
  detailed: {
    name: '详细',
    description: '详细、全面、步骤清晰',
    prompt: '请用详细、全面的语气回复，分步骤说明，包含所有必要信息，确保用户完全理解。'
  }
};

/** 所有可用语气 ID（用于校验） */
const TONE_IDS = Object.keys(TONE_CONFIGS);

// ============ 情感响应模板 ============
const EMOTION_TEMPLATES = {
  complaint: {
    negative: '非常抱歉给您带来了不便，我们深表歉意。',
    neutral: '感谢您的反馈，我们会认真处理。',
    positive: '感谢您的认可，我们会继续努力！'
  },
  consult: {
    negative: '理解您的困惑，让我为您详细解释。',
    neutral: '很高兴为您解答这个问题。',
    positive: '很高兴能帮助到您！'
  },
  urgent: {
    negative: '非常抱歉让您久等了，我们立即为您处理。',
    neutral: '我们会对您的紧急需求优先处理。',
    positive: '感谢您的信任，我们会快速响应！'
  },
  casual: {
    negative: '抱歉让您不开心了。',
    neutral: '你好！很高兴和你聊天。',
    positive: '哈哈，我也这么觉得！'
  }
};

// ============ JSDoc 类型定义 ============

/**
 * @typedef {Object} RewriteOptions
 * @property {string}  [userMessage]    - 用户本轮提问
 * @property {Array}  [conversationHistory] - 对话历史 [{ role, content }]
 * @property {string}  [tone=friendly]     - 语气：professional/friendly/concise/detailed
 * @property {string}  [userName]           - 用户姓名（个性化用）
 * @property {boolean} [isReturnUser=false]   - 是否老用户
 * @property {Object}  [intent]             - 意图对象（含 primaryIntent）
 */

/**
 * @typedef {Object} QualityScore
 * @property {number} fluency       - 流畅度 0-1
 * @property {number} naturalness   - 自然度 0-1
 * @property {number} infoRetention - 信息保留率 0-1
 * @property {number} colloquialism - 口语化程度 0-1
 * @property {number} overallScore - 综合得分 0-1
 * @property {Array<string>} suggestions - 改进建议
 */

// ============ 核心功能 ============

/**
 * 口语化改写（核心功能）
 * @param {string} originalAnswer - 原始答案（非空）
 * @param {RewriteOptions} [options={}]
 * @returns {Promise<string>} 改写后的答案（失败时返回原答案）
 */
async function rewriteToColloquial(originalAnswer, options = {}) {
  // ---- 输入校验 ----
  if (!originalAnswer || typeof originalAnswer !== 'string') {
    console.warn('[AnswerRewriter] originalAnswer 无效，返回空字符串');
    return '';
  }

  const answer = originalAnswer.slice(0, MAX_ANSWER_LENGTH);
  const {
    userMessage = '',
    conversationHistory = [],
    tone = 'friendly',
    userName = '',
    isReturnUser = false,
    intent = null,
    faqId = null // 新增：传入 FAQ id 以启用改写结果缓存
  } = options;

  // 校验语气参数
  const toneKey = TONE_IDS.includes(tone) ? tone : 'friendly';
  const toneConfig = TONE_CONFIGS[toneKey];

  // ---- 缓存命中检查（仅 FAQ 场景且答案足够长）----
  let cacheKey = null;
  const answerHash = hashString(answer);
  if (faqId && answer.length > 20) {
    const model = getActiveRewriteModel();
    cacheKey = buildRewriteCacheKey(faqId, model, toneKey);
    const hit = rewriteCache.get(cacheKey);
    if (hit && hit.answerHash === answerHash) {
      hit.hits++;
      console.log(`[AnswerRewriter] 命中改写缓存，跳过 LLM（faqId=${faqId}, 模型=${model}, 命中${hit.hits}次, 耗时≈0ms）`);
      return hit.rewritten;
    }
  }

  // ---- 构建 Prompt 各部分 ----
  const historyContext = buildHistoryContext(conversationHistory);
  const personalization = buildPersonalization(userName, isReturnUser);
  const emotionResponse = buildEmotionResponse(intent);

  const systemPrompt = buildRewriteSystemPrompt({
    tonePrompt: toneConfig.prompt,
    personalization,
    emotionResponse
  });

  const userPrompt = `【对话历史】：${historyContext}
【用户当前问题】：${userMessage.slice(0, MAX_USER_MESSAGE_LENGTH)}
【标准答案】：${answer}

请直接返回改写后的回复（不要有任何前缀或解释）：`;

  // ---- 调用 LLM ----
  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const rewritten = await callOllamaChat(messages, {
      baseURL: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
      temperature: 0.3,
      max_tokens: 800
    });

    // 后处理：清除多余引号/前缀
    const cleaned = cleanRewritten(rewritten);
    const result = cleaned || answer; // 若清洗后为空，降级返回原答案

    // ---- 写入缓存（仅当改写成功且与原文不同）----
    if (cacheKey && result && result !== answer) {
      rewriteCache.set(cacheKey, { answerHash, rewritten: result, hits: 1 });
      // 超限清理（删除最早插入项，Map 保持插入顺序）
      if (rewriteCache.size > REWRITE_CACHE_MAX_SIZE) {
        const oldest = rewriteCache.keys().next().value;
        rewriteCache.delete(oldest);
      }
      console.log(`[AnswerRewriter] 改写完成并缓存，原长度: ${answer.length}, 新长度: ${result.length}, 缓存数: ${rewriteCache.size}`);
    } else {
      console.log(`[AnswerRewriter] 改写完成，原长度: ${answer.length}, 新长度: ${result.length}`);
    }
    return result;

  } catch (err) {
    console.error('[AnswerRewriter] 改写失败，使用原答案：', err.message);
    return answer;
  }
}

/**
 * 批量改写（并发控制，单条失败不影响整体）
 * @param {Array<{ original: string, userMessage?: string, conversationHistory?: Array }>} items
 * @param {RewriteOptions} [options={}]
 * @returns {Promise<Array<{ original: string, rewritten: string, success: boolean, error?: string }>>}
 */
async function batchRewrite(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const results = [];
  const BATCH_SIZE = 3; // 与意图理解并发数一致

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (item) => {
        try {
          const rewritten = await rewriteToColloquial(item.original, {
            ...options,
            userMessage: item.userMessage || '',
            conversationHistory: item.conversationHistory || []
          });
          return {
            original: item.original,
            rewritten,
            success: true
          };
        } catch (err) {
          return {
            original: item.original,
            rewritten: item.original,
            success: false,
            error: err.message
          };
        }
      })
    );
    results.push(...batchResults);
  }

  return results;
}

/**
 * 质量评估（让 LLM 评估改写后的质量）
 * @param {string} original  - 原始答案
 * @param {string} rewritten - 改写后答案
 * @returns {Promise<QualityScore>}
 */
async function evaluateQuality(original, rewritten) {
  if (!original || !rewritten) {
    return buildDefaultQualityScore(0, ['原始答案或改写结果为空']);
  }

  const systemPrompt = `你是文本质量评估专家。请评估改写后的答案的质量。

评估维度（均为 0-1 浮点数）：
1. fluency（流畅度）：语言是否流畅自然
2. naturalness（自然度）：是否像人说的，而不是机器
3. infoRetention（信息保留率）：关键信息是否完整保留
4. colloquialism（口语化程度）：是否成功改为口语

请只返回 JSON 对象，不要有其他内容。格式：
{
  "fluency": 0.9,
  "naturalness": 0.85,
  "infoRetention": 0.95,
  "colloquialism": 0.8,
  "overallScore": 0.875,
  "suggestions": ["建议1", "建议2"]
}`;

  const userPrompt = `【原始答案】：${original.slice(0, 1000)}
【改写后答案】：${rewritten.slice(0, 1000)}

请评估质量：`;

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await callOllamaChat(messages, {
      baseURL: OLLAMA_BASE_URL,
      model: OLLAMA_MODEL,
      temperature: 0.1,
      max_tokens: 500
    });

    const parsed = parseQualityJSON(result);
    if (parsed) return parsed;

    // 解析失败返回默认评分
    return buildDefaultQualityScore(0.5, ['评估解析失败，请手动检查']);

  } catch (err) {
    console.error('[AnswerRewriter] 质量评估失败：', err.message);
    return buildDefaultQualityScore(0, ['评估失败：' + err.message]);
  }
}

// ============ Prompt 构建辅助函数 ============

/**
 * 构建对话历史上下文字符串
 * @param {Array} history - [{ role, content }]
 * @returns {string}
 */
function buildHistoryContext(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '（无）';
  }

  const recent = history.slice(-3);
  let result = '\n\n===== 对话历史（最近3轮）=====\n';
  for (const m of recent) {
    const role = m.role === 'user' ? '用户' : '客服';
    result += `${role}：${m.content.slice(0, 100)}\n`;
  }
  return result;
}

/**
 * 构建个性化说明字符串
 * @param {string} userName
 * @param {boolean} isReturnUser
 * @returns {string}
 */
function buildPersonalization(userName, isReturnUser) {
  const lines = [];
  if (userName) {
    lines.push(`- 用户姓名：${userName}`);
  }
  if (isReturnUser) {
    lines.push('- 这是老用户，可以简洁回复，不需要重复解释基础概念');
  } else {
    lines.push('- 这是新用户，需要详细引导，解释清楚每个步骤');
  }
  return lines.length > 0 ? '\n' + lines.join('\n') : '';
}

/**
 * 构建情感化响应前缀
 * @param {Object|null} intent - 意图对象
 * @returns {string}
 */
function buildEmotionResponse(intent) {
  if (!intent || !intent.primaryIntent) return '';

  const intentType = intent.primaryIntent.level1 || 'consult';
  const emotion = intent.primaryIntent.sentiment || 'neutral';

  const template = EMOTION_TEMPLATES[intentType] || EMOTION_TEMPLATES.consult;
  return template[emotion] || template.neutral || '';
}

/**
 * 构建完整的改写系统 Prompt
 * @param {Object} params
 * @param {string} params.tonePrompt
 * @param {string} params.personalization
 * @param {string} params.emotionResponse
 * @returns {string}
 */
function buildRewriteSystemPrompt({ tonePrompt, personalization, emotionResponse }) {
  const sw = loadSoftwareInfo();
  let prompt = `你是「${sw.softwareName}」的智能客服，名字叫「${sw.assistantName}」。
  
  【【【 核心原则（必须遵守）】】】
  1. 【100%保持原意】- 改写后的答案必须完全保留原答案的核心信息和含义
  2. 【只改表达方式】- 只改变说话方式（书面→口语），绝对不改变说话内容
  3. 【禁止添加信息】- 不要添加原答案中没有的信息
  4. 【禁止改变主题】- 如果原答案说"报销已批准"，改写后也必须说"报销已批准"
  5. 【禁止改变结论】- 如果原答案说"不能办理"，改写后也必须说"不能办理"
  
  【【【 错误示例（绝对不要这样做）】】】
  ❌ 原答案："您的报销申请已批准"
  ❌ 错误改写："你好，看起来你的问题有些不清楚..."  ← 这完全改变了原意！
  ✅ 正确改写："您好呀！您的报销申请已经通过啦~"
  
  【【【 任务说明】】】
  你的任务是将【标准答案】改写成更自然、更友好、更个性化的回复。
  
  ## 语气要求
  ${tonePrompt}`;

  if (personalization) {
    prompt += `\n\n## 个性化要求${personalization}`;
  }

  if (emotionResponse) {
    prompt += `\n\n## 情感要求\n在回复开头适当添加情感化表达：${emotionResponse}`;
  }

  prompt += `\n\n## 改写规则
1. 口语化：将书面语改为口语（"须提供" → "需要您提供"，"须" → "需要"）
2. 自然化：避免使用"根据标准答案..."、"根据政策规定..."等机械表达
3. 个性化：根据用户名、新老用户调整表达方式
4. 情感化：根据意图和情感，在开头添加适当的情感响应（投诉先道歉、咨询先友好）
5. 连贯性：如果对话历史中有上下文，请在回复中适当引用，让回复更连贯
6. 简洁性：控制在2-3句话内（除非是"详细"语气）
7. 准确性：保持信息准确，不要编造

## 禁止事项
- 不要说"根据标准答案..."
- 不要说"根据政策规定..."
- 不要说"FAQ显示..."
- 不要编造信息
- 不要使用过于正式的书面语`;

  return prompt;
}

// ============ 后处理 ============

/**
 * 清洗改写结果（去除多余引号、前缀）
 * @param {string} text
 * @returns {string}
 */
function cleanRewritten(text) {
  let cleaned = text.trim();

  // 去除首尾引号（中英文）
  cleaned = cleaned.replace(/^["'"「]+|["'"」]+$/g, '');

  // 去除常见前缀
  cleaned = cleaned.replace(/^(回复|改写结果|答案)[：:\s]*/i, '');

  return cleaned;
}

/**
 * 解析质量评估的 JSON 返回
 * @param {string} text - LLM 返回文本
 * @returns {QualityScore|null}
 */
function parseQualityJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  const jsonStr = match ? match[0] : text;

  try {
    const parsed = JSON.parse(jsonStr);
    // 校验必要字段
    return {
      fluency: clampScore(parsed.fluency),
      naturalness: clampScore(parsed.naturalness),
      infoRetention: clampScore(parsed.infoRetention),
      colloquialism: clampScore(parsed.colloquialism),
      overallScore: clampScore(parsed.overallScore),
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 10) : []
    };
  } catch (e) {
    console.warn('[AnswerRewriter] 质量评估 JSON 解析失败:', e.message);
    return null;
  }
}

/**
 * 构建默认质量评分
 * @param {number} score
 * @param {Array<string>} suggestions
 * @returns {QualityScore}
 */
function buildDefaultQualityScore(score, suggestions) {
  return {
    fluency: score,
    naturalness: score,
    infoRetention: score,
    colloquialism: score,
    overallScore: score,
    suggestions
  };
}

/**
 * 将数值钳制在 [0, 1] 范围内
 * @param {*} val
 * @returns {number}
 */
function clampScore(val) {
  const num = Number(val);
  if (Number.isNaN(num)) return 0.5;
  return Math.min(1, Math.max(0, num));
}

// ============ 导出 ============

/**
 * 获取可用的语气列表（供前端下拉框使用）
 * @returns {Array<{ id: string, name: string, description: string }>}
 */
function getToneList() {
  return Object.entries(TONE_CONFIGS).map(([key, config]) => ({
    id: key,
    name: config.name,
    description: config.description
  }));
}

module.exports = {
  rewriteToColloquial,
  batchRewrite,
  evaluateQuality,
  getToneList,
  clearRewriteCache,
  getRewriteCacheStats,
  TONE_CONFIGS,
  EMOTION_TEMPLATES
};
