/**
 * 共享 Ollama LLM 调用模块
 * 消除各模块中的重复 LLM 调用代码，统一错误处理与超时控制
 */

const http = require('http');
const https = require('https');

// 默认配置
const DEFAULT_BASE_URL = 'http://172.17.6.18:11434';
const DEFAULT_MODEL = 'qwen2.5:14b';
const DEFAULT_TIMEOUT = 60000; // 60秒（优化：从30秒增加到60秒）
const DEFAULT_MAX_TOKENS = 500;

/**
 * 调用 Ollama LLM（chat 接口，推荐）
 * @param {Array} messages - 消息数组 [{role, content}]
 * @param {Object} options - 可选配置
 * @param {string} options.baseURL - Ollama 基地址
 * @param {string} options.model - 模型名称
 * @param {number} options.temperature - 温度参数 0-1
 * @param {number} options.max_tokens - 最大 token 数
 * @param {number} options.timeout - 超时毫秒
 * @returns {Promise<string>} - LLM 返回的文本内容
 */
async function callOllamaChat(messages, options = {}) {
  const baseURL = options.baseURL || DEFAULT_BASE_URL;
  const model = options.model || DEFAULT_MODEL;
  const temperature = options.temperature ?? 0.3;
  const maxTokens = options.max_tokens || DEFAULT_MAX_TOKENS;
  const timeout = options.timeout || DEFAULT_TIMEOUT;

  const url = new URL(`${baseURL}/v1/chat/completions`);
  const payload = JSON.stringify({
    model,
    messages,
    stream: false,
    options: {
      temperature,
      num_predict: maxTokens,
      ...options.llm_options
    }
  });

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout
    };

    const req = http.request(reqOptions, (res) => {
      // 检查 HTTP 状态码
      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', chunk => errorData += chunk);
        res.on('end', () => {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${errorData.slice(0, 200)}`));
        });
        return;
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content?.trim() || '';
          if (!content) {
            reject(new Error('Ollama 返回内容为空'));
          } else {
            resolve(content);
          }
        } catch (e) {
          reject(new Error(`Ollama 响应解析失败: ${e.message}, 原始数据: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Ollama 请求失败: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Ollama 请求超时 (${timeout}ms)`));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * 调用 Ollama LLM（generate 接口，兼容旧版）
 * @param {string} prompt - 提示词文本
 * @param {Object} options - 可选配置（同 callOllamaChat）
 * @returns {Promise<string>} - LLM 返回的文本内容
 */
async function callOllamaGenerate(prompt, options = {}) {
  const baseURL = options.baseURL || DEFAULT_BASE_URL;
  const model = options.model || DEFAULT_MODEL;
  const temperature = options.temperature ?? 0.1;
  const maxTokens = options.max_tokens || DEFAULT_MAX_TOKENS;
  const timeout = options.timeout || DEFAULT_TIMEOUT;
  const format = options.format || null; // 'json' 时要求 LLM 返回 JSON

  const url = new URL(`${baseURL}/api/generate`);
  const body = {
    model,
    prompt,
    stream: false,
    options: {
      temperature,
      num_predict: maxTokens,
      ...options.llm_options
    }
  };
  if (format) body.format = format;

  const payload = JSON.stringify(body);

  return new Promise((resolve, reject) => {
    const reqOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout
    };

    const req = http.request(reqOptions, (res) => {
      if (res.statusCode !== 200) {
        let errorData = '';
        res.on('data', chunk => { errorData += chunk; });
        res.on('end', () => {
          reject(new Error(`Ollama HTTP ${res.statusCode}: ${errorData.slice(0, 200)}`));
        });
        return;
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = (parsed.response || '').trim();
          if (!content) {
            reject(new Error('Ollama 返回内容为空'));
          } else {
            resolve(content);
          }
        } catch (e) {
          reject(new Error(`Ollama 响应解析失败: ${e.message}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Ollama 请求失败: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Ollama 请求超时 (${timeout}ms)`));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * 调用 LLM 并解析 JSON 返回（增强容错）
 * @param {string} prompt - 提示词
 * @param {Object} options - 配置项
 * @returns {Promise<Object|null>} - 解析后的 JSON 对象，解析失败返回 null
 */
async function callOllamaJSON(prompt, options = {}) {
  const content = await callOllamaGenerate(prompt, { ...options, format: 'json' });
  
  if (!content) {
    console.warn('[OllamaClient] LLM 返回内容为空');
    return null;
  }
  
  // 策略1：直接解析（最快）
  try {
    return JSON.parse(content);
  } catch (e1) {
    console.log('[OllamaClient] 直接解析失败，尝试提取JSON...');
  }
  
  // 策略2：提取markdown代码块中的JSON
  try {
    const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      const jsonStr = codeBlockMatch[1].trim();
      return JSON.parse(jsonStr);
    }
  } catch (e2) {
    console.log('[OllamaClient] 代码块提取失败，尝试正则匹配...');
  }
  
  // 策略3：正则匹配第一个完整的JSON对象（处理嵌套）
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[0];
      // 尝试智能截断修复（处理不完整的JSON）
      const repaired = repairJSON(jsonStr);
      return JSON.parse(repaired);
    }
  } catch (e3) {
    console.warn('[OllamaClient] 所有JSON解析策略均失败:', e3.message);
  }
  
  // 策略4：降级为文本返回（返回一个默认结构）
  console.warn('[OllamaClient] JSON解析失败，返回默认结构');
  return null;
}

/**
 * 尝试修复不完整的JSON字符串
 * @param {string} jsonStr - 可能不完整的JSON字符串
 * @returns {string} - 修复后的JSON字符串
 */
function repairJSON(jsonStr) {
  // 修复1：移除可能的尾部逗号
  let repaired = jsonStr.replace(/,\s*\}/g, '}').replace(/,\s*\]/g, ']');
  
  // 修复2：补全缺失的闭合括号
  const stack = [];
  let inString = false;
  let escapeNext = false;
  
  for (let i = 0; i < repaired.length; i++) {
    const char = repaired[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{' || char === '[') {
        stack.push(char);
      } else if (char === '}') {
        if (stack.pop() !== '{') throw new Error('Invalid JSON: bracket mismatch');
      } else if (char === ']') {
        if (stack.pop() !== '[') throw new Error('Invalid JSON: bracket mismatch');
      }
    }
  }
  
  // 补全缺失的闭合括号
  while (stack.length > 0) {
    const open = stack.pop();
    if (open === '{') repaired += '}';
    else if (open === '[') repaired += ']';
  }
  
  return repaired;
}

module.exports = {
  callOllamaChat,
  callOllamaGenerate,
  callOllamaJSON,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TIMEOUT
};
