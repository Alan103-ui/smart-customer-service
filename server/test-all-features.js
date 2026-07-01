/**
 * 功能全面测试脚本
 * 测试：对话功能、知识库管理、RAG检索
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';
let authToken = null;
let testResults = [];

// ============ 辅助函数 ============
function httpRequest(method, path, data = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers: headers,
      timeout: 30000,
    };

    if (data && typeof data === 'object') {
      data = JSON.stringify(data);
      options.headers['Content-Type'] = 'application/json';
      options.headers['Content-Length'] = Buffer.byteLength(data);
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed, headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, data: body, headers: res.headers });
        }
      });
    });

    req.on('error', (e) => reject(e));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    if (data) req.write(data);
    req.end();
  });
}

// ============ 测试函数 ============
async function login() {
  console.log('\n[1] 登录获取Token...');
  try {
    const res = await httpRequest('POST', '/api/auth/login', {
      username: 'admin',
      password: 'admin123',
    });
    
    if (res.status === 200 && res.data.token) {
      authToken = res.data.token;
      logTest('登录', true, 'Token获取成功');
      return true;
    } else {
      logTest('登录', false, 'Token获取失败: ' + JSON.stringify(res.data));
      return false;
    }
  } catch (e) {
    logTest('登录', false, e.message);
    return false;
  }
}

async function testDialogueFunction() {
  console.log('\n[2] 测试对话功能...');
  
  // 2.1 测试增强对话API（REST接口）
  try {
    const res = await httpRequest('POST', '/api/chat/enhance', {
      query: '广康集团的主营业务是什么？',
      sessionId: 'test-session-' + Date.now(),
    }, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success) {
      const answer = res.data.enhanced?.enhancedAnswer || res.data.original || '';
      logTest('对话功能-REST接口', true, `回答长度: ${answer.length}字符`);
    } else {
      logTest('对话功能-REST接口', false, '接口返回异常: ' + JSON.stringify(res.data).substring(0, 100));
    }
  } catch (e) {
    logTest('对话功能-REST接口', false, e.message);
  }
  
  // 2.2 测试对话历史
  try {
    const res = await httpRequest('POST', '/api/chat/history', {
      sessionId: 'test-session',
    }, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200) {
      logTest('对话历史', true, `历史记录数: ${res.data.length || 0}`);
    } else {
      logTest('对话历史', false, '接口返回异常');
    }
  } catch (e) {
    logTest('对话历史', false, e.message);
  }
  
  // 2.3 测试记忆统计
  try {
    const res = await httpRequest('GET', '/api/chat/memory-stats', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200) {
      logTest('对话记忆统计', true, `总记忆数: ${res.data.total || 0}`);
    } else {
      logTest('对话记忆统计', false, '接口返回异常');
    }
  } catch (e) {
    logTest('对话记忆统计', false, e.message);
  }
}

async function testKnowledgeBaseManagement() {
  console.log('\n[3] 测试知识库管理...');
  
  // 3.1 测试获取知识库列表
  try {
    const res = await httpRequest('GET', '/api/admin/knowledge-bases', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && Array.isArray(res.data)) {
      logTest('知识库列表', true, `知识库数量: ${res.data.length}`);
    } else {
      logTest('知识库列表', false, '接口返回异常');
    }
  } catch (e) {
    logTest('知识库列表', false, e.message);
  }
  
  // 3.2 测试获取分类列表
  try {
    const res = await httpRequest('GET', '/api/admin/categories', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && Array.isArray(res.data)) {
      logTest('分类列表', true, `分类数量: ${res.data.length}`);
    } else {
      logTest('分类列表', false, '接口返回异常');
    }
  } catch (e) {
    logTest('分类列表', false, e.message);
  }
  
  // 3.3 测试获取FAQ列表
  try {
    const res = await httpRequest('GET', '/api/admin/faq', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success && Array.isArray(res.data.data)) {
      logTest('FAQ列表', true, `FAQ数量: ${res.data.data.length}`);
    } else {
      logTest('FAQ列表', false, '接口返回异常: ' + JSON.stringify(res.data).substring(0, 100));
    }
  } catch (e) {
    logTest('FAQ列表', false, e.message);
  }
}

async function testRAGRetrieval() {
  console.log('\n[4] 测试RAG检索...');
  
  // 4.1 测试向量库统计
  try {
    const res = await httpRequest('GET', '/api/admin/vector-stats', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.totalChunks !== undefined) {
      logTest('向量库统计', true, `总chunk数: ${res.data.totalChunks}, 模型: ${res.data.embeddingModel}`);
    } else {
      logTest('向量库统计', false, '接口返回异常');
    }
  } catch (e) {
    logTest('向量库统计', false, e.message);
  }
  
  // 4.2 测试RAG搜索
  try {
    const res = await httpRequest('POST', '/api/chat/enhance', {
      query: '广康集团有哪些产品？',
      sessionId: 'test-rag-' + Date.now(),
      useRAG: true,
    }, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success) {
      const answer = res.data.enhanced?.enhancedAnswer || res.data.original || '';
      const hasSources = res.data.enhanced?.sources && res.data.enhanced.sources.length > 0;
      logTest('RAG检索', true, `回答长度: ${answer.length}字符, 来源数: ${res.data.enhanced?.sources?.length || 0}`);
    } else {
      logTest('RAG检索', false, '接口返回异常: ' + JSON.stringify(res.data).substring(0, 100));
    }
  } catch (e) {
    logTest('RAG检索', false, e.message);
  }
  
  // 4.3 测试重排序功能
  try {
    const res = await httpRequest('GET', '/api/admin/models/status', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.health) {
      const rerankerOk = res.data.health.reranker?.available;
      logTest('重排序功能', rerankerOk, `Rerank服务状态: ${rerankerOk ? '正常' : '异常'}`);
    } else {
      logTest('重排序功能', false, '接口返回异常');
    }
  } catch (e) {
    logTest('重排序功能', false, e.message);
  }
}

async function testModelPerformance() {
  console.log('\n[5] 测试模型性能监控...');
  
  // 5.1 测试性能报告API
  try {
    const res = await httpRequest('GET', '/api/admin/models/performance', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success) {
      const report = res.data.report;
      let totalRequests = 0;
      Object.keys(report).forEach(type => {
        totalRequests += report[type].totalRequests || 0;
      });
      logTest('性能监控API', true, `总请求数: ${totalRequests}`);
    } else {
      logTest('性能监控API', false, '接口返回异常');
    }
  } catch (e) {
    logTest('性能监控API', false, e.message);
  }
  
  // 5.2 测试模型状态API
  try {
    const res = await httpRequest('GET', '/api/admin/models/status', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success) {
      logTest('模型状态API', true, `当前模型: ${JSON.stringify(res.data.currentModels)}`);
    } else {
      logTest('模型状态API', false, '接口返回异常');
    }
  } catch (e) {
    logTest('模型状态API', false, e.message);
  }
}

// ============ 日志记录 ============
function logTest(name, passed, details = '') {
  const result = {
    name,
    passed,
    details,
    timestamp: new Date().toISOString(),
  };
  testResults.push(result);
  
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${name}: ${details}`);
}

// ============ 生成测试报告 ============
function generateTestReport() {
  console.log('\n' + '='.repeat(60));
  console.log('测试报告');
  console.log('='.repeat(60));
  
  const totalTests = testResults.length;
  const passedTests = testResults.filter(r => r.passed).length;
  const failedTests = totalTests - passedTests;
  const passRate = ((passedTests / totalTests) * 100).toFixed(2);
  
  console.log(`\n总测试数: ${totalTests}`);
  console.log(`通过: ${passedTests}`);
  console.log(`失败: ${failedTests}`);
  console.log(`通过率: ${passRate}%`);
  
  if (failedTests > 0) {
    console.log('\n失败的测试:');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.details}`);
    });
  }
  
  console.log('\n详细结果:');
  testResults.forEach(r => {
    const icon = r.passed ? '✅' : '❌';
    console.log(`  ${icon} ${r.name}`);
    if (r.details) {
      console.log(`     详情: ${r.details}`);
    }
  });
  
  console.log('\n' + '='.repeat(60));
  
  // 保存测试报告到文件
  const reportPath = path.join(__dirname, 'test-report-' + new Date().toISOString().split('T')[0] + '.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    summary: {
      totalTests,
      passedTests,
      failedTests,
      passRate: parseFloat(passRate),
    },
    details: testResults,
  }, null, 2));
  
  console.log(`\n测试报告已保存: ${reportPath}`);
}

// ============ 主函数 ============
async function main() {
  console.log('='.repeat(60));
  console.log('广康AI智能客服系统 - 功能全面测试');
  console.log('='.repeat(60));
  
  // 1. 登录
  if (!await login()) {
    console.log('\n❌ 登录失败，测试终止');
    return;
  }
  
  // 2. 测试对话功能
  await testDialogueFunction();
  
  // 3. 测试知识库管理
  await testKnowledgeBaseManagement();
  
  // 4. 测试RAG检索
  await testRAGRetrieval();
  
  // 5. 测试模型性能监控
  await testModelPerformance();
  
  // 6. 生成测试报告
  generateTestReport();
}

main().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
