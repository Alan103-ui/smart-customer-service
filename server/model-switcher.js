/**
 * 模型自动切换管理器（增强版）
 * 功能：监控Ollama模型健康状态、自动切换主备模型、性能监控
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// ============ 配置 ============
const OLLAMA_HOST = '172.17.6.18';
const OLLAMA_PORT = 11434;
const PERF_LOG_PATH = path.join(__dirname, 'data', 'model-performance.json');

const MODEL_CONFIG = {
  embedding: {
    primary: 'bge-m3:latest',
    fallback: 'qwen2.5:14b',
    timeout: 10000,
  },
  llm: {
    primary: 'qwen2.5:14b',
    fallback: 'qwen2.5:7b',
    timeout: 60000,
  },
  reranker: {
    primary: 'bge-reranker-v2-m3:latest',
    fallback: null,
    timeout: 10000,
    serviceUrl: 'http://172.17.6.18:8000/rerank',
  },
};

// ============ 当前使用的模型 ============
let currentModels = {
  embedding: MODEL_CONFIG.embedding.primary,
  llm: MODEL_CONFIG.llm.primary,
  reranker: MODEL_CONFIG.reranker.primary,
};

// ============ 模型健康状态 ============
let modelHealth = {
  embedding: { available: true, lastCheck: 0, error: null },
  llm: { available: true, lastCheck: 0, error: null },
  reranker: { available: true, lastCheck: 0, error: null },
};

// ============ 模型性能监控（新增） ============
let modelPerformance = {
  embedding: {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalResponseTime: 0,
    avgResponseTime: 0,
    minResponseTime: Infinity,
    maxResponseTime: 0,
    lastResponseTime: 0,
    successRate: 100,
    requestsPerMinute: 0,
    recentRequests: [],  // 最近100次请求记录
    lastMinuteRequests: 0,
    lastMinuteTimestamp: Date.now(),
  },
  llm: {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalResponseTime: 0,
    avgResponseTime: 0,
    minResponseTime: Infinity,
    maxResponseTime: 0,
    lastResponseTime: 0,
    successRate: 100,
    requestsPerMinute: 0,
    recentRequests: [],
    lastMinuteRequests: 0,
    lastMinuteTimestamp: Date.now(),
  },
  reranker: {
    totalRequests: 0,
    successRequests: 0,
    failedRequests: 0,
    totalResponseTime: 0,
    avgResponseTime: 0,
    minResponseTime: Infinity,
    maxResponseTime: 0,
    lastResponseTime: 0,
    successRate: 100,
    requestsPerMinute: 0,
    recentRequests: [],
    lastMinuteRequests: 0,
    lastMinuteTimestamp: Date.now(),
  },
};

// ============ 性能监控配置 ============
const PERF_CONFIG = {
  maxRecentRequests: 100,  // 保存最近100次请求记录
  saveInterval: 300000,     // 每5分钟保存一次性能数据
  alertThreshold: {
    responseTime: 5000,     // 响应时间超过5秒告警
    successRate: 80,         // 成功率低于80%告警
    requestsPerMinute: 100,  // 每分钟请求数超过100告警
  },
};

// ============ 记录请求性能（新增） ============
function recordRequest(type, success, responseTime, error = null) {
  const perf = modelPerformance[type];
  if (!perf) return;
  
  // 更新总请求数
  perf.totalRequests++;
  
  // 更新成功/失败数
  if (success) {
    perf.successRequests++;
  } else {
    perf.failedRequests++;
  }
  
  // 更新响应时间
  if (success) {
    perf.totalResponseTime += responseTime;
    perf.avgResponseTime = perf.totalResponseTime / perf.successRequests;
    perf.minResponseTime = Math.min(perf.minResponseTime, responseTime);
    perf.maxResponseTime = Math.max(perf.maxResponseTime, responseTime);
    perf.lastResponseTime = responseTime;
  }
  
  // 更新成功率
  perf.successRate = (perf.successRequests / perf.totalRequests) * 100;
  
  // 更新最近请求记录
  const requestRecord = {
    timestamp: Date.now(),
    success,
    responseTime,
    error,
  };
  perf.recentRequests.push(requestRecord);
  if (perf.recentRequests.length > PERF_CONFIG.maxRecentRequests) {
    perf.recentRequests.shift();
  }
  
  // 更新每分钟请求数
  const now = Date.now();
  if (now - perf.lastMinuteTimestamp >= 60000) {
    // 已过一分钟，计算上一分钟的请求数
    perf.requestsPerMinute = perf.lastMinuteRequests;
    perf.lastMinuteRequests = 0;
    perf.lastMinuteTimestamp = now;
  }
  perf.lastMinuteRequests++;
  
  // 检查告警阈值
  checkPerformanceAlerts(type);
}

// ============ 检查性能告警（新增） ============
function checkPerformanceAlerts(type) {
  const perf = modelPerformance[type];
  const thresholds = PERF_CONFIG.alertThreshold;
  const alerts = [];
  
  if (perf.avgResponseTime > thresholds.responseTime) {
    alerts.push(`响应时间过高: ${perf.avgResponseTime.toFixed(0)}ms > ${thresholds.responseTime}ms`);
  }
  
  if (perf.successRate < thresholds.successRate) {
    alerts.push(`成功率过低: ${perf.successRate.toFixed(1)}% < ${thresholds.successRate}%`);
  }
  
  if (perf.requestsPerMinute > thresholds.requestsPerMinute) {
    alerts.push(`请求频率过高: ${perf.requestsPerMinute}次/分钟 > ${thresholds.requestsPerMinute}次/分钟`);
  }
  
  if (alerts.length > 0) {
    console.warn(`[ModelSwitcher] ⚠️ 性能告警 (${type}):`);
    alerts.forEach(alert => console.warn(`  - ${alert}`));
  }
}

// ============ 保存性能数据（新增） ============
function savePerformanceData() {
  try {
    const dataDir = path.dirname(PERF_LOG_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    const data = {
      timestamp: Date.now(),
      performance: modelPerformance,
      currentModels,
      modelHealth,
    };
    
    fs.writeFileSync(PERF_LOG_PATH, JSON.stringify(data, null, 2));
    console.log('[ModelSwitcher] 性能数据已保存');
  } catch (e) {
    console.error('[ModelSwitcher] 保存性能数据失败:', e.message);
  }
}

// ============ 加载性能数据（新增） ============
function loadPerformanceData() {
  try {
    if (!fs.existsSync(PERF_LOG_PATH)) return false;
    
    const data = JSON.parse(fs.readFileSync(PERF_LOG_PATH, 'utf8'));
    
    // 恢复性能数据
    Object.keys(data.performance).forEach(type => {
      if (modelPerformance[type]) {
        modelPerformance[type] = data.performance[type];
      }
    });
    
    console.log('[ModelSwitcher] 性能数据已加载');
    return true;
  } catch (e) {
    console.error('[ModelSwitcher] 加载性能数据失败:', e.message);
    return false;
  }
}

// ============ 获取性能报告（新增） ============
function getPerformanceReport(type = null) {
  if (type) {
    const perf = modelPerformance[type];
    if (!perf) return null;
    
    return {
      type,
      currentModel: currentModels[type],
      totalRequests: perf.totalRequests,
      successRequests: perf.successRequests,
      failedRequests: perf.failedRequests,
      successRate: perf.successRate.toFixed(2) + '%',
      avgResponseTime: perf.avgResponseTime.toFixed(0) + 'ms',
      minResponseTime: (perf.minResponseTime === Infinity ? 0 : perf.minResponseTime) + 'ms',
      maxResponseTime: perf.maxResponseTime + 'ms',
      lastResponseTime: perf.lastResponseTime + 'ms',
      requestsPerMinute: perf.requestsPerMinute,
      healthStatus: modelHealth[type]?.available ? '正常' : '异常',
      lastHealthCheck: modelHealth[type]?.lastCheck ? new Date(modelHealth[type].lastCheck).toLocaleString() : '未知',
    };
  }
  
  // 返回所有模型的报告
  const report = {};
  Object.keys(modelPerformance).forEach(t => {
    report[t] = getPerformanceReport(t);
  });
  return report;
}

// ============ 重置性能统计（新增） ============
function resetPerformanceStats(type = null) {
  const resetObj = (perf) => {
    perf.totalRequests = 0;
    perf.successRequests = 0;
    perf.failedRequests = 0;
    perf.totalResponseTime = 0;
    perf.avgResponseTime = 0;
    perf.minResponseTime = Infinity;
    perf.maxResponseTime = 0;
    perf.lastResponseTime = 0;
    perf.successRate = 100;
    perf.requestsPerMinute = 0;
    perf.recentRequests = [];
    perf.lastMinuteRequests = 0;
    perf.lastMinuteTimestamp = Date.now();
  };
  
  if (type) {
    if (modelPerformance[type]) {
      resetObj(modelPerformance[type]);
      console.log(`[ModelSwitcher] ${type} 性能统计已重置`);
    }
  } else {
    Object.keys(modelPerformance).forEach(t => resetObj(modelPerformance[t]));
    console.log('[ModelSwitcher] 所有模型性能统计已重置');
  }
}

// ============ 检查Ollama模型健康状态（增强版） ============
function checkOllamaHealth(modelName) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/show',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };
    
    const payload = JSON.stringify({ name: modelName });
    options.headers['Content-Length'] = Buffer.byteLength(payload);
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        const success = res.statusCode === 200;
        
        // 记录性能数据
        const type = modelName.includes('bge-m3') || modelName.includes('nomic') || modelName.includes('mxbai') ? 'embedding' : 'llm';
        recordRequest(type, success, responseTime, success ? null : `状态码: ${res.statusCode}`);
        
        if (success) {
          resolve({ available: true, error: null, responseTime });
        } else {
          resolve({ available: false, error: `状态码: ${res.statusCode}`, responseTime });
        }
      });
    });
    
    req.on('error', (e) => {
      const responseTime = Date.now() - startTime;
      const type = modelName.includes('bge-m3') || modelName.includes('nomic') || modelName.includes('mxbai') ? 'embedding' : 'llm';
      recordRequest(type, false, responseTime, e.message);
      resolve({ available: false, error: e.message, responseTime });
    });
    
    req.on('timeout', () => {
      const responseTime = Date.now() - startTime;
      req.destroy();
      const type = modelName.includes('bge-m3') || modelName.includes('nomic') || modelName.includes('mxbai') ? 'embedding' : 'llm';
      recordRequest(type, false, responseTime, '请求超时');
      resolve({ available: false, error: '请求超时', responseTime });
    });
    
    req.write(payload);
    req.end();
  });
}

// ============ 检查Rerank服务健康状态（增强版） ============
function checkRerankHealth() {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const options = {
      hostname: '172.17.6.18',
      port: 8000,
      path: '/rerank',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };
    
    const payload = JSON.stringify({
      query: '测试',
      documents: ['文档1', '文档2'],
    });
    options.headers['Content-Length'] = Buffer.byteLength(payload);
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const responseTime = Date.now() - startTime;
        try {
          const result = JSON.parse(data);
          if (result.results && Array.isArray(result.results)) {
            recordRequest('reranker', true, responseTime);
            resolve({ available: true, error: null, responseTime });
          } else {
            recordRequest('reranker', false, responseTime, '响应格式异常');
            resolve({ available: false, error: '响应格式异常', responseTime });
          }
        } catch (e) {
          recordRequest('reranker', false, responseTime, e.message);
          resolve({ available: false, error: e.message, responseTime });
        }
      });
    });
    
    req.on('error', (e) => {
      const responseTime = Date.now() - startTime;
      recordRequest('reranker', false, responseTime, e.message);
      resolve({ available: false, error: e.message, responseTime });
    });
    
    req.on('timeout', () => {
      const responseTime = Date.now() - startTime;
      req.destroy();
      recordRequest('reranker', false, responseTime, '请求超时');
      resolve({ available: false, error: '请求超时', responseTime });
    });
    
    req.write(payload);
    req.end();
  });
}

// ============ 执行健康检查（增强版） ============
async function performHealthCheck() {
  console.log('[ModelSwitcher] 开始健康检查...');
  const startTime = Date.now();
  
  // 检查嵌入模型
  const embeddingHealth = await checkOllamaHealth(currentModels.embedding);
  modelHealth.embedding = {
    available: embeddingHealth.available,
    lastCheck: Date.now(),
    error: embeddingHealth.error,
    lastResponseTime: embeddingHealth.responseTime,
  };
  
  if (!embeddingHealth.available && currentModels.embedding === MODEL_CONFIG.embedding.primary) {
    console.warn(`[ModelSwitcher] ⚠️ 主嵌入模型不可用: ${currentModels.embedding}`);
    console.log(`[ModelSwitcher] 切换到fallback模型: ${MODEL_CONFIG.embedding.fallback}`);
    currentModels.embedding = MODEL_CONFIG.embedding.fallback;
  } else if (embeddingHealth.available && currentModels.embedding !== MODEL_CONFIG.embedding.primary) {
    console.log(`[ModelSwitcher] ✅ 主嵌入模型恢复，切换回去: ${MODEL_CONFIG.embedding.primary}`);
    currentModels.embedding = MODEL_CONFIG.embedding.primary;
  }
  
  // 检查LLM模型
  const llmHealth = await checkOllamaHealth(currentModels.llm);
  modelHealth.llm = {
    available: llmHealth.available,
    lastCheck: Date.now(),
    error: llmHealth.error,
    lastResponseTime: llmHealth.responseTime,
  };
  
  if (!llmHealth.available && currentModels.llm === MODEL_CONFIG.llm.primary) {
    console.warn(`[ModelSwitcher] ⚠️ 主LLM模型不可用: ${currentModels.llm}`);
    if (MODEL_CONFIG.llm.fallback) {
      console.log(`[ModelSwitcher] 切换到fallback模型: ${MODEL_CONFIG.llm.fallback}`);
      currentModels.llm = MODEL_CONFIG.llm.fallback;
    }
  } else if (llmHealth.available && currentModels.llm !== MODEL_CONFIG.llm.primary) {
    console.log(`[ModelSwitcher] ✅ 主LLM模型恢复，切换回去: ${MODEL_CONFIG.llm.primary}`);
    currentModels.llm = MODEL_CONFIG.llm.primary;
  }
  
  // 检查Rerank服务
  const rerankHealth = await checkRerankHealth();
  modelHealth.reranker = {
    available: rerankHealth.available,
    lastCheck: Date.now(),
    error: rerankHealth.error,
    lastResponseTime: rerankHealth.responseTime,
  };
  
  const totalTime = Date.now() - startTime;
  console.log(`[ModelSwitcher] 健康检查完成 (耗时${totalTime}ms)`);
  console.log(`  嵌入: ${currentModels.embedding} (${modelHealth.embedding.available ? '✅' : '❌'})`);
  console.log(`  LLM: ${currentModels.llm} (${modelHealth.llm.available ? '✅' : '❌'})`);
  console.log(`  Rerank: ${modelHealth.reranker.available ? '✅' : '❌'}`);
}

// ============ 启动自动切换（增强版） ============
function startAutoSwitch(interval = 60000) {
  console.log('[ModelSwitcher] 启动模型自动切换（间隔: ' + interval + 'ms）...');
  
  // 加载历史性能数据
  loadPerformanceData();
  
  // 立即执行一次健康检查
  performHealthCheck();
  
  // 定期执行健康检查
  setInterval(performHealthCheck, interval);
  
  // 定期保存性能数据
  setInterval(savePerformanceData, PERF_CONFIG.saveInterval);
  console.log(`[ModelSwitcher] 性能数据自动保存已启动（间隔: ${PERF_CONFIG.saveInterval / 1000}秒）`);
}

// ============ 获取当前模型 ============
function getCurrentModel(type) {
  if (type) {
    return currentModels[type];
  }
  return currentModels;
}

// ============ 获取健康状态 ============
function getHealthStatus() {
  return {
    currentModels,
    modelHealth,
    config: MODEL_CONFIG,
  };
}

// ============ 手动切换模型 ============
function switchModel(type, modelName) {
  if (!MODEL_CONFIG[type]) {
    return { success: false, error: `未知的模型类型: ${type}` };
  }
  
  console.log(`[ModelSwitcher] 手动切换模型: ${type} → ${modelName}`);
  currentModels[type] = modelName;
  
  return { success: true, message: `已切换到 ${modelName}` };
}

// ============ 导出（增强版） ============
module.exports = {
  startAutoSwitch,
  getCurrentModel,
  getHealthStatus,
  switchModel,
  getPerformanceReport,
  resetPerformanceStats,
  savePerformanceData,
  loadPerformanceData,
  recordRequest,  // 供外部调用以记录实际请求性能
  MODEL_CONFIG,
  currentModels,
  modelHealth,
  modelPerformance,  // 导出性能数据供API使用
};

// 如果直接运行此文件，执行测试
if (require.main === module) {
  console.log('=== 模型自动切换管理器测试 ===\n');
  
  startAutoSwitch(10000); // 每10秒检查一次
  
  // 每30秒打印一次状态
  setInterval(() => {
    const status = getHealthStatus();
    console.log('\n=== 当前模型状态 ===');
    console.log(JSON.stringify(status, null, 2));
  }, 30000);
}
