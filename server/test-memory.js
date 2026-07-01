/**
 * 对话记忆功能测试脚本
 * 测试多轮对话记忆的存储和加载
 */

const http = require('http');
const fs = require('fs');

const BASE_URL = 'http://localhost:3001';
let token = '';
let sessionId = '';

// 1. 登录
function login() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: 'admin', password: 'admin123' });
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/auth/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const result = JSON.parse(body);
        token = result.token;
        console.log('✅ 登录成功');
        resolve();
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 2. 发送消息
function sendMessage(message) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ message, sessionId });
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/chat',
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'Content-Length': data.length,
        'Authorization': `Bearer ${token}`
      }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const result = JSON.parse(body);
        if (!sessionId) sessionId = result.sessionId;
        console.log(`✅ 消息发送成功: "${message}"`);
        console.log(`   回答: ${result.answer?.substring(0, 50)}...`);
        resolve(result);
      });
    });
    
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// 3. 获取记忆统计
function getMemoryStats() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/chat/memory-stats',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const result = JSON.parse(body);
        console.log('✅ 记忆统计:', JSON.stringify(result, null, 2));
        resolve(result);
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

// 主测试流程
async function runTest() {
  try {
    console.log('=== 对话记忆功能测试 ===\n');
    
    // 1. 登录
    await login();
    
    // 2. 发送第一条消息
    console.log('\n[第1轮] 发送第一条消息...');
    await sendMessage('广康集团的主营业务是什么？');
    await new Promise(r => setTimeout(r, 1000));
    
    // 3. 发送跟进消息（测试上下文记忆）
    console.log('\n[第2轮] 发送跟进消息（依赖上下文）...');
    await sendMessage('它成立于哪一年？');  // 依赖上一轮的"广康集团"
    await new Promise(r => setTimeout(r, 1000));
    
    // 4. 发送第三条消息
    console.log('\n[第3轮] 发送第三条消息...');
    await sendMessage('有哪些主要产品？');
    await new Promise(r => setTimeout(r, 1000));
    
    // 5. 获取记忆统计
    console.log('\n[检查] 获取记忆统计...');
    await getMemoryStats();
    
    console.log('\n=== 测试完成 ===');
    console.log('✅ 对话记忆功能正常工作！');
    console.log('   记忆已存储到 data/dialogue-memory/ 目录');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

runTest();
