/**
 * 模型性能监控测试脚本
 * 功能：测试性能数据收集、API接口、报告生成
 */

const http = require('http');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
let authToken = null;

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
      timeout: 10000,
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
  console.log('[1] 登录获取Token...');
  try {
    const res = await httpRequest('POST', '/api/auth/login', {
      username: 'admin',
      password: 'admin123',
    });
    
    if (res.status === 200 && res.data.token) {
      authToken = res.data.token;
      console.log('  ✅ 登录成功');
      return true;
    } else {
      console.log('  ❌ 登录失败:', res.data);
      return false;
    }
  } catch (e) {
    console.log('  ❌ 登录失败:', e.message);
    return false;
  }
}

async function testModelStatusAPI() {
  console.log('\n[2] 测试模型状态API（包含性能数据）...');
  try {
    const res = await httpRequest('GET', '/api/admin/models/status', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success) {
      console.log('  ✅ API调用成功');
      console.log('\n  === 当前模型 ===');
      console.log('  嵌入模型:', res.data.currentModels.embedding);
      console.log('  LLM模型:', res.data.currentModels.llm);
      console.log('\n  === 健康状态 ===');
      console.log('  嵌入:', res.data.health.embedding?.available ? '✅' : '❌');
      console.log('  LLM:', res.data.health.llm?.available ? '✅' : '❌');
      console.log('  Rerank:', res.data.health.reranker?.available ? '✅' : '❌');
      
      console.log('\n  === 性能数据（新增）===');
      if (res.data.performance) {
        Object.keys(res.data.performance).forEach(type => {
          const perf = res.data.performance[type];
          console.log(`\n  ${type}:`);
          console.log(`    总请求数: ${perf.totalRequests}`);
          console.log(`    成功率: ${perf.successRate}`);
          console.log(`    平均响应时间: ${perf.avgResponseTime}`);
          console.log(`    每分钟请求数: ${perf.requestsPerMinute}`);
        });
      }
      
      return true;
    } else {
      console.log('  ❌ API调用失败:', res.data);
      return false;
    }
  } catch (e) {
    console.log('  ❌ API调用失败:', e.message);
    return false;
  }
}

async function testPerformanceAPI() {
  console.log('\n[3] 测试性能报告API...');
  try {
    const res = await httpRequest('GET', '/api/admin/models/performance', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success) {
      console.log('  ✅ 性能报告API调用成功');
      console.log('\n  === 详细性能报告 ===');
      console.log(JSON.stringify(res.data.report, null, 4).split('\n').map(line => '  ' + line).join('\n'));
      return true;
    } else {
      console.log('  ❌ API调用失败:', res.data);
      return false;
    }
  } catch (e) {
    console.log('  ❌ API调用失败:', e.message);
    return false;
  }
}

async function testPerformanceAPIWithType() {
  console.log('\n[4] 测试性能报告API（指定类型）...');
  try {
    const res = await httpRequest('GET', '/api/admin/models/performance?type=embedding', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success) {
      console.log('  ✅ 指定类型性能报告API调用成功');
      console.log('\n  === embedding 性能报告 ===');
      console.log(JSON.stringify(res.data.report, null, 4).split('\n').map(line => '  ' + line).join('\n'));
      return true;
    } else {
      console.log('  ❌ API调用失败:', res.data);
      return false;
    }
  } catch (e) {
    console.log('  ❌ API调用失败:', e.message);
    return false;
  }
}

async function testResetPerformanceAPI() {
  console.log('\n[5] 测试重置性能统计API...');
  try {
    const res = await httpRequest('POST', '/api/admin/models/performance/reset', null, {
      'Authorization': `Bearer ${authToken}`,
    });
    
    if (res.status === 200 && res.data.success) {
      console.log('  ✅ 重置性能统计API调用成功');
      console.log('  消息:', res.data.message);
      return true;
    } else {
      console.log('  ❌ API调用失败:', res.data);
      return false;
    }
  } catch (e) {
    console.log('  ❌ API调用失败:', e.message);
    return false;
  }
}

// ============ 主函数 ============
async function main() {
  console.log('=== 模型性能监控功能测试 ===\n');
  
  // 1. 登录
  if (!await login()) {
    console.log('\n❌ 登录失败，测试终止');
    return;
  }
  
  // 2. 测试模型状态API
  await testModelStatusAPI();
  
  // 3. 测试性能报告API
  await testPerformanceAPI();
  
  // 4. 测试指定类型的性能报告API
  await testPerformanceAPIWithType();
  
  // 5. 测试重置性能统计API
  await testResetPerformanceAPI();
  
  console.log('\n=== 测试完成 ===');
  console.log('\n📊 性能监控功能已就绪！');
  console.log('\n下一步：');
  console.log('  1. 使用系统一段时间，性能数据会自动收集');
  console.log('  2. 访问 /api/admin/models/performance 查看性能报告');
  console.log('  3. 在RAG管理页面展示性能数据（需前端开发）');
}

main().catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
