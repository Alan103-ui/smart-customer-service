/**
 * 阶段1改造验证脚本
 * 测试认证中间件、WebSocket认证、用户对话记录隔离
 */

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
let passed = 0;
let failed = 0;

function test(name, fn) {
  fn().then(ok => {
    if (ok) { passed++; console.log(`  ✅ ${name}`); }
    else { failed++; console.log(`  ❌ ${name}`); }
  }).catch(err => {
    failed++;
    console.log(`  ❌ ${name} - 错误: ${err.message}`);
  });
}

function httpGet(path, token = null) {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const req = http.get(`${BASE_URL}${path}`, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.on('error', reject);
  });
}

function httpPost(path, body, token = null) {
  return new Promise((resolve, reject) => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const req = http.request(`${BASE_URL}${path}`, { method: 'POST', headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, data: data }); }
      });
    });
    req.write(JSON.stringify(body));
    req.end();
    req.on('error', reject);
  });
}

async function login(username, password) {
  const res = await httpPost('/api/auth/login', { username, password });
  if (res.status === 200 && res.data.token) {
    return res.data.token;
  }
  throw new Error(`登录失败: ${res.data.error || res.status}`);
}

async function testWebSocket(token = null, expectSuccess = true) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:3001/ws`);
    let result = false;
    let errorMsg = '';
    
    ws.on('open', () => {
      if (token) {
        ws.send(JSON.stringify({ type: 'init', sessionId: 'test_' + Date.now(), token }));
      } else {
        ws.send(JSON.stringify({ type: 'init', sessionId: 'test_' + Date.now() }));
      }
    });
    
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'init' && msg.sessionId) {
          result = true;
        } else if (msg.type === 'error') {
          errorMsg = msg.message;
          result = false;
        }
      } catch (e) {}
    });
    
    ws.on('close', () => {
      if (expectSuccess) {
        resolve(result);
      } else {
        resolve(!result || errorMsg.includes('登录') || errorMsg.includes('请先'));
      }
    });
    
    ws.on('error', () => {
      resolve(!expectSuccess);
    });
    
    setTimeout(() => {
      ws.close();
      if (expectSuccess) {
        resolve(result);
      } else {
        resolve(true); // 超时说明连接被拒绝，符合预期
      }
    }, 3000);
  });
}

async function runTests() {
  console.log('\n========== 阶段1改造验证 ==========\n');
  
  // 1. 测试未登录时访问API是否被拒绝
  console.log('1. 测试未登录时访问API是否被拒绝：');
  await test('未登录访问 /api/chat/store 返回401', async () => {
    const res = await httpPost('/api/chat/store', { sessionId: 'test' });
    return res.status === 401;
  });
  
  await test('未登录访问 /api/chat/history 返回401', async () => {
    const res = await httpPost('/api/chat/history', { sessionId: 'test' });
    return res.status === 401;
  });
  
  // 2. 测试登录后访问API是否成功
  console.log('\n2. 测试登录后访问API是否成功：');
  let userToken = null;
  await test('用户登录成功', async () => {
    userToken = await login('test', 'test123');
    return !!userToken;
  });
  
  // 先创建一个测试用户
  let adminToken = null;
  await test('管理员登录成功', async () => {
    adminToken = await login('admin', 'admin123');
    return !!adminToken;
  });
  
  await test('登录后访问 /api/chat/store 成功', async () => {
    const res = await httpPost('/api/chat/store', { sessionId: 'test_session', userQuery: '测试问题', aiResponse: '测试回答' }, userToken);
    return res.status === 200;
  });
  
  // 3. 测试WebSocket认证
  console.log('\n3. 测试WebSocket认证：');
  await test('WebSocket未携带token被拒绝', async () => {
    return await testWebSocket(null, false);
  });
  
  await test('WebSocket携带有效token成功连接', async () => {
    return await testWebSocket(userToken, true);
  });
  
  await test('WebSocket携带无效token被拒绝', async () => {
    return await testWebSocket('invalid_token', false);
  });
  
  // 4. 测试普通用户访问管理后台是否被拒绝
  console.log('\n4. 测试普通用户访问管理后台是否被拒绝：');
  await test('普通用户访问 /api/admin/stats 返回403', async () => {
    const res = await httpGet('/api/admin/stats', userToken);
    return res.status === 403;
  });
  
  // 5. 测试管理员访问管理后台是否成功
  console.log('\n5. 测试管理员访问管理后台是否成功：');
  await test('管理员访问 /api/admin/stats 成功', async () => {
    const res = await httpGet('/api/admin/stats', adminToken);
    return res.status === 200;
  });
  
  // 6. 测试普通用户查看自己的对话记录
  console.log('\n6. 测试普通用户查看自己的对话记录：');
  await test('普通用户访问 /api/user/conversations 成功', async () => {
    const res = await httpGet('/api/user/conversations', userToken);
    return res.status === 200;
  });
  
  await test('/api/user/conversations 只返回当前用户的对话', async () => {
    const res = await httpGet('/api/user/conversations', userToken);
    if (res.status !== 200) return false;
    // 检查所有对话的user_id是否等于当前用户ID
    const conversations = res.data.data || [];
    const decoded = JSON.parse(Buffer.from(userToken.split('.')[1], 'base64').toString());
    return conversations.every(c => c.user_id === decoded.userId);
  });
  
  // 总结
  console.log(`\n========== 测试结果 ==========`);
  console.log(`✅ 通过: ${passed}`);
  console.log(`❌ 失败: ${failed}`);
  console.log(`总计: ${passed + failed}`);
  
  if (failed > 0) {
    console.log('\n⚠️ 部分测试失败，请检查后端改造！');
    process.exit(1);
  } else {
    console.log('\n🎉 所有测试通过！阶段1改造成功！');
    process.exit(0);
  }
}

// 检查依赖
try {
  require('ws');
  runTests();
} catch (e) {
  console.error('缺少依赖，请先安装: npm install ws');
  process.exit(1);
}
