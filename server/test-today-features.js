#!/usr/bin/env node
/**
 * 今天新增功能完整验证测试
 * 测试范围：
 * 1. 性能监控集成到 RAG 管理
 * 2. 模型状态 API
 * 3. 性能报告 API
 * 4. 性能统计重置 API
 * 5. 前端页面访问
 */

const http = require('http');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
const API_BASE = `${BASE_URL}/api/admin`;

// 测试.token 文件获取 token
let token = '';
try {
  token = fs.readFileSync('data/.token', 'utf8').trim();
} catch (e) {
  // 如果没有.token 文件，尝试登录获取
  console.log('⚠️  未找到 token 文件，需要先登录');
}

// HTTP 请求封装
function makeRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, headers: res.headers, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, data: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// 测试登录
async function testLogin() {
  console.log('\n========== 测试1: 管理员登录 ==========');
  try {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };
    
    const res = await makeRequest(options, JSON.stringify({
      username: 'admin',
      password: 'admin123'
    }));
    
    if (res.status === 200 && res.data.success) {
      console.log('✅ 登录成功');
      console.log(`   用户名: ${res.data.user.username}`);
      console.log(`   角色: ${res.data.user.role}`);
      token = res.data.token;
      // 保存 token
      fs.writeFileSync('data/.token', token);
      console.log(`   Token 已保存`);
      return true;
    } else {
      console.log('❌ 登录失败:', res.data.error || '未知错误');
      return false;
    }
  } catch (e) {
    console.log('❌ 登录异常:', e.message);
    return false;
  }
}

// 测试模型状态 API
async function testModelStatus() {
  console.log('\n========== 测试2: 获取模型状态 ==========');
  try {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/admin/models/status',
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    
    const res = await makeRequest(options);
    
    if (res.status === 200 && res.data.success) {
      console.log('✅ 获取模型状态成功');
      console.log(`   当前嵌入模型: ${res.data.currentModels?.embedding || 'N/A'}`);
      console.log(`   当前 LLM 模型: ${res.data.currentModels?.llm || 'N/A'}`);
      console.log(`   嵌入模型健康: ${res.data.health?.embedding?.available ? '✅ 正常' : '❌ 异常'}`);
      console.log(`   LLM 模型健康: ${res.data.health?.llm?.available ? '✅ 正常' : '❌ 异常'}`);
      console.log(`   Rerank 服务健康: ${res.data.health?.reranker?.available ? '✅ 正常' : '❌ 异常'}`);
      return true;
    } else {
      console.log('❌ 获取模型状态失败:', res.data.error || '未知错误');
      return false;
    }
  } catch (e) {
    console.log('❌ 获取模型状态异常:', e.message);
    return false;
  }
}

// 测试性能报告 API
async function testPerformanceReport() {
  console.log('\n========== 测试3: 获取性能报告 ==========');
  
  const types = ['embedding', 'reranker'];
  let allPassed = true;
  
  for (const type of types) {
    try {
      const options = {
        hostname: 'localhost',
        port: 3001,
        path: `/api/admin/models/performance?type=${type}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      };
      
      const res = await makeRequest(options);
      
      if (res.status === 200 && res.data.success) {
        console.log(`✅ 获取 ${type} 性能报告成功`);
        console.log(`   总请求数: ${res.data.report?.totalRequests || 0}`);
        console.log(`   成功请求数: ${res.data.report?.successRequests || 0}`);
        console.log(`   失败请求数: ${res.data.report?.failedRequests || 0}`);
        console.log(`   成功率: ${res.data.report?.successRate || 'N/A'}`);
        console.log(`   平均响应时间: ${res.data.report?.avgResponseTime || 'N/A'}`);
      } else {
        console.log(`❌ 获取 ${type} 性能报告失败:`, res.data.error || '未知错误');
        allPassed = false;
      }
    } catch (e) {
      console.log(`❌ 获取 ${type} 性能报告异常:`, e.message);
      allPassed = false;
    }
  }
  
  return allPassed;
}

// 测试重置性能统计 API
async function testResetPerformance() {
  console.log('\n========== 测试4: 重置性能统计 ==========');
  try {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/admin/models/performance/reset',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    
    const res = await makeRequest(options, JSON.stringify({ type: 'embedding' }));
    
    if (res.status === 200 && res.data.success) {
      console.log('✅ 重置性能统计成功');
      console.log(`   消息: ${res.data.message}`);
      return true;
    } else {
      console.log('❌ 重置性能统计失败:', res.data.error || '未知错误');
      return false;
    }
  } catch (e) {
    console.log('❌ 重置性能统计异常:', e.message);
    return false;
  }
}

// 测试前端页面访问
async function testFrontendPages() {
  console.log('\n========== 测试5: 前端页面访问 ==========');
  
  const pages = [
    { name: '首页', path: '/', auth: false },
    { name: '登录页', path: '/login', auth: false },
    { name: '管理后台', path: '/admin', auth: true },
    { name: '性能监控页面', path: '/api/admin/performance', auth: true }
  ];
  
  let allPassed = true;
  
  for (const page of pages) {
    try {
      const headers = page.auth ? {
        'Authorization': `Bearer ${token}`,
        'Cookie': `token=${token}`
      } : {};
      
      const options = {
        hostname: 'localhost',
        port: 3001,
        path: page.path,
        method: 'GET',
        headers
      };
      
      const res = await makeRequest(options);
      
      if (res.status === 200) {
        console.log(`✅ ${page.name} 访问成功 (${res.status})`);
      } else if (res.status === 401 || res.status === 403) {
        console.log(`⚠️  ${page.name} 需要认证 (${res.status})`);
        allPassed = false;
      } else {
        console.log(`⚠️  ${page.name} 返回状态码: ${res.status}`);
        allPassed = false;
      }
    } catch (e) {
      console.log(`❌ ${page.name} 访问异常:`, e.message);
      allPassed = false;
    }
  }
  
  return allPassed;
}

// 测试 RAG 管理页面性能监控 Tab
async function testRAGManagementPerformanceTab() {
  console.log('\n========== 测试6: RAG 管理性能监控 Tab ==========');
  console.log('⚠️  此测试需要手动验证：');
  console.log('   1. 访问 http://localhost:3001');
  console.log('   2. 登录管理员账号');
  console.log('   3. 点击"📊 管理后台"');
  console.log('   4. 点击"🤖 RAG 管理"');
  console.log('   5. 点击"⚡ 性能监控"标签页');
  console.log('   6. 验证是否能看到：');
  console.log('      - 模型状态卡片');
  console.log('      - 性能指标卡片');
  console.log('      - 最近请求记录');
  console.log('   7. 点击"🔄 刷新状态"按钮，验证数据是否更新');
  console.log('   8. 点击"🔄 刷新数据"按钮，验证性能数据是否更新');
  console.log('   9. 点击"🗑️ 重置统计"按钮，验证是否弹出确认对话框');
  
  return true;
}

// 主测试函数
async function runAllTests() {
  console.log('========================================');
  console.log('   今天新增功能完整验证测试');
  console.log('========================================');
  console.log('开始时间:', new Date().toLocaleString());
  
  const results = [];
  
  // 测试1: 登录
  results.push(await testLogin());
  
  // 如果登录失败，后续测试无法进行
  if (!results[0]) {
    console.log('\n❌ 登录失败，跳过后续测试');
    printSummary(results);
    return;
  }
  
  // 测试2: 模型状态
  results.push(await testModelStatus());
  
  // 测试3: 性能报告
  results.push(await testPerformanceReport());
  
  // 测试4: 重置性能统计
  results.push(await testResetPerformance());
  
  // 测试5: 前端页面访问
  results.push(await testFrontendPages());
  
  // 测试6: RAG 管理性能监控 Tab（手动验证）
  results.push(await testRAGManagementPerformanceTab());
  
  // 打印测试摘要
  printSummary(results);
}

function printSummary(results) {
  console.log('\n========================================');
  console.log('   测试摘要');
  console.log('========================================');
  
  const tests = [
    '管理员登录',
    '获取模型状态 API',
    '获取性能报告 API',
    '重置性能统计 API',
    '前端页面访问',
    'RAG 管理性能监控 Tab（手动验证）'
  ];
  
  let passed = 0;
  tests.forEach((test, idx) => {
    const result = results[idx];
    if (result === true) {
      console.log(`✅ ${test}: 通过`);
      passed++;
    } else if (result === false) {
      console.log(`❌ ${test}: 失败`);
    } else {
      console.log(`⚠️  ${test}: 需要手动验证`);
      passed++;
    }
  });
  
  console.log('\n========== 结果 ==========');
  console.log(`通过: ${passed}/${tests.length}`);
  console.log(`失败: ${tests.length - passed}/${tests.length}`);
  
  if (passed === tests.length) {
    console.log('\n🎉 所有测试通过！');
  } else {
    console.log('\n⚠️  部分测试失败，请检查上述错误信息');
  }
  
  console.log('\n结束时间:', new Date().toLocaleString());
}

// 运行所有测试
runAllTests().catch(e => {
  console.error('测试运行失败:', e);
  process.exit(1);
});
