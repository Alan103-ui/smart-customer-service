#!/usr/bin/env node
/**
 * A8连接测试工具
 * 用法：node test-a8-connection.js
 * 
 * 功能：
 * 1. 测试A8 REST API连接
 * 2. 验证API账号权限
 * 3. 测试CAS认证（如果启用）
 * 4. 输出详细诊断信息
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

console.log('🔍 A8系统连接测试工具\n');
console.log('='.repeat(60));

// 1. 检查配置
console.log('\n📋 1. 检查A8配置...');
const A8_SERVER_URL = process.env.A8_SERVER_URL;
const A8_API_USERNAME = process.env.A8_API_USERNAME;
const A8_API_PASSWORD = process.env.A8_API_PASSWORD;
const A8_CAS_SERVER_URL = process.env.A8_CAS_SERVER_URL;
const A8_SSO_TRUST_MODE = process.env.A8_SSO_TRUST_MODE || '0';

if (!A8_SERVER_URL) {
  console.error('❌ A8_SERVER_URL 未配置！');
  console.log('   请在 .env 文件中设置：');
  console.log('   A8_SERVER_URL=http://your-a8-server/seeyon\n');
  process.exit(1);
}

console.log(`   A8服务器地址: ${A8_SERVER_URL}`);
console.log(`   API账号: ${A8_API_USERNAME || '(未配置)'}`);
console.log(`   CAS服务器: ${A8_CAS_SERVER_URL || '(未配置)'}`);
console.log(`   SSO信任模式: ${A8_SSO_TRUST_MODE === '1' ? '是' : '否'}`);

// 2. 测试REST API连接
console.log('\n🌐 2. 测试REST API连接...');
if (!A8_API_USERNAME || !A8_API_PASSWORD) {
  console.warn('⚠️  API账号未配置，跳过REST API测试');
  console.log('   请在 .env 文件中设置 A8_API_USERNAME 和 A8_API_PASSWORD\n');
} else {
  testA8RestAPI(A8_SERVER_URL, A8_API_USERNAME, A8_API_PASSWORD);
}

// 3. 测试CAS连接
if (A8_CAS_SERVER_URL) {
  console.log('\n🔐 3. 测试CAS服务器连接...');
  testA8CAS(A8_CAS_SERVER_URL);
} else {
  console.log('\n⏭️  跳过CAS测试（A8_CAS_SERVER_URL 未配置）');
}

// 4. 生成测试报告
console.log('\n📊 4. 生成测试报告...');
const report = {
  timestamp: new Date().toISOString(),
  a8_server_url: A8_SERVER_URL,
  api_configured: !!(A8_API_USERNAME && A8_API_PASSWORD),
  cas_configured: !!A8_CAS_SERVER_URL,
  trust_mode: A8_SSO_TRUST_MODE === '1',
  next_steps: []
};

if (!A8_API_USERNAME || !A8_API_PASSWORD) {
  report.next_steps.push('配置A8 API账号：设置 A8_API_USERNAME 和 A8_API_PASSWORD');
}

if (!A8_CAS_SERVER_URL) {
  report.next_steps.push('（可选）配置A8 CAS服务器：设置 A8_CAS_SERVER_URL');
}

report.next_steps.push('运行 SSO配置测试：node test-sso-config.js');
report.next_steps.push('启动服务测试：npm start');

console.log('\n📋 测试报告：');
console.log(JSON.stringify(report, null, 2));

console.log('\n' + '='.repeat(60));
console.log('✅ A8连接测试完成！');
console.log('='.repeat(60) + '\n');

// ============ 辅助函数 ============

function testA8RestAPI(baseURL, username, password) {
  return new Promise((resolve) => {
    console.log(`   测试URL: ${baseURL}/rest/orgMember/view/-1`);
    
    const url = new URL(baseURL);
    const client = url.protocol === 'https:' ? https : http;
    
    const auth = Buffer.from(`${username}:${password}`).toString('base64');
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: '/seeyon/rest/orgMember/view/-1',
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 5000
    };
    
    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        console.log(`   状态码: ${res.statusCode}`);
        
        if (res.statusCode === 200) {
          console.log('   ✅ REST API连接成功！');
          try {
            const json = JSON.parse(data);
            if (json.name) {
              console.log(`   管理员账号: ${json.name}`);
            }
            console.log(`   响应数据: ${JSON.stringify(json).substring(0, 100)}...`);
          } catch (e) {
            console.log(`   响应长度: ${data.length} 字符`);
          }
        } else if (res.statusCode === 401) {
          console.error('   ❌ 认证失败（用户名或密码错误）');
          console.log('   请检查 A8_API_USERNAME 和 A8_API_PASSWORD 配置');
        } else if (res.statusCode === 403) {
          console.error('   ❌ 权限不足（账号没有API访问权限）');
          console.log('   请确保账号有REST API访问权限');
        } else {
          console.error(`   ❌ 请求失败：${res.statusCode}`);
          console.error(`   响应：${data.substring(0, 200)}`);
        }
        resolve();
      });
    });
    
    req.on('error', (err) => {
      console.error(`   ❌ 连接失败：${err.message}`);
      console.log('\n   可能的原因：');
      console.log('   1. A8服务器地址错误');
      console.log('   2. A8服务器未启动');
      console.log('   3. 网络连接问题');
      console.log('   4. 防火墙阻止访问');
      resolve();
    });
    
    req.on('timeout', () => {
      console.error('   ❌ 连接超时（5秒）');
      req.destroy();
      resolve();
    });
    
    req.end();
  });
}

function testA8CAS(casURL) {
  return new Promise((resolve) => {
    console.log(`   测试URL: ${casURL}`);
    
    const url = new URL(casURL);
    const client = url.protocol === 'https:' ? https : http;
    
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      timeout: 5000
    };
    
    const req = client.request(options, (res) => {
      console.log(`   状态码: ${res.statusCode}`);
      
      if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) {
        console.log('   ✅ CAS服务器可访问！');
      } else {
        console.warn(`   ⚠️  Unexpected status code: ${res.statusCode}`);
      }
      resolve();
    });
    
    req.on('error', (err) => {
      console.error(`   ❌ CAS服务器连接失败：${err.message}`);
      console.log('\n   可能的原因：');
      console.log('   1. CAS服务器地址错误');
      console.log('   2. CAS服务器未启动');
      console.log('   3. 网络连接问题');
      resolve();
    });
    
    req.on('timeout', () => {
      console.error('   ❌ 连接超时（5秒）');
      req.destroy();
      resolve();
    });
    
    req.end();
  });
}
