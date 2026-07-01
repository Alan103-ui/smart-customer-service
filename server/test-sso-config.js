#!/usr/bin/env node
/**
 * SSO配置测试工具
 * 用法：node test-sso-config.js
 * 
 * 功能：
 * 1. 检查.env文件是否存在
 * 2. 验证必填配置项
 * 3. 测试SSO提供商连接
 * 4. 输出详细诊断信息
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

console.log('🔍 SSO配置测试工具\n');
console.log('=' .repeat(60));

// 1. 检查.env文件
console.log('\n📁 1. 检查环境配置文件...');
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('❌ .env文件不存在！');
  console.log('   请复制 .env.example 为 .env，并填写配置：');
  console.log('   cp .env.example .env\n');
  process.exit(1);
}
console.log('✅ .env文件存在');

// 2. 加载配置
console.log('\n📋 2. 加载配置项...');
const config = {
  SSO_ENABLED: process.env.SSO_ENABLED || '0',
  SSO_PROVIDER: process.env.SSO_PROVIDER || 'oa',
  SSO_LOGIN_URL: process.env.SSO_LOGIN_URL || '',
  SSO_VERIFY_URL: process.env.SSO_VERIFY_URL || '',
  SSO_CLIENT_ID: process.env.SSO_CLIENT_ID || '',
  SSO_CLIENT_SECRET: process.env.SSO_CLIENT_SECRET || '',
  A8_SERVER_URL: process.env.A8_SERVER_URL || '',
  A8_CAS_SERVER_URL: process.env.A8_CAS_SERVER_URL || '',
  A8_API_USERNAME: process.env.A8_API_USERNAME || '',
  A8_API_PASSWORD: process.env.A8_API_PASSWORD || '',
  A8_SSO_TRUST_MODE: process.env.A8_SSO_TRUST_MODE || '0',
  JWT_SECRET: process.env.JWT_SECRET || '',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3001'
};

console.log('   配置项                    状态');
console.log('   ' + '-'.repeat(50));
console.log(`   SSO_ENABLED               ${config.SSO_ENABLED === '1' ? '✅ 已启用' : '⚠️  已禁用'}`);
console.log(`   SSO_PROVIDER              ${config.SSO_PROVIDER}`);
console.log(`   SSO_LOGIN_URL             ${config.SSO_LOGIN_URL ? '✅ ' + config.SSO_LOGIN_URL : '❌ 未配置'}`);
console.log(`   SSO_VERIFY_URL            ${config.SSO_VERIFY_URL ? '✅ ' + config.SSO_VERIFY_URL : '❌ 未配置'}`);
console.log(`   SSO_CLIENT_ID             ${config.SSO_CLIENT_ID ? '✅ ' + config.SSO_CLIENT_ID : '❌ 未配置'}`);
console.log(`   SSO_CLIENT_SECRET         ${config.SSO_CLIENT_SECRET ? '✅ 已配置（长度:' + config.SSO_CLIENT_SECRET.length + '）' : '❌ 未配置'}`);
console.log(`   A8_SERVER_URL             ${config.A8_SERVER_URL ? '✅ ' + config.A8_SERVER_URL : '⚠️  未配置'}`);
console.log(`   A8_CAS_SERVER_URL         ${config.A8_CAS_SERVER_URL ? '✅ ' + config.A8_CAS_SERVER_URL : '⚠️  未配置'}`);
console.log(`   A8_API_USERNAME           ${config.A8_API_USERNAME ? '✅ ' + config.A8_API_USERNAME : '⚠️  未配置'}`);
console.log(`   A8_API_PASSWORD           ${config.A8_API_PASSWORD ? '✅ 已配置（长度:' + config.A8_API_PASSWORD.length + '）' : '⚠️  未配置'}`);
console.log(`   A8_SSO_TRUST_MODE         ${config.A8_SSO_TRUST_MODE === '1' ? '⚠️  信任模式（仅测试）' : '✅ 标准模式'}`);
console.log(`   JWT_SECRET                ${config.JWT_SECRET ? '✅ 已配置（长度:' + config.JWT_SECRET.length + '）' : '❌ 未配置'}`);
console.log(`   FRONTEND_URL              ${config.FRONTEND_URL}`);

// 3. 验证必填项
console.log('\n✅ 3. 验证必填配置项...');
const errors = [];
const warnings = [];

if (!config.JWT_SECRET) {
  errors.push('JWT_SECRET 未配置（生产环境必须修改）');
}

if (config.SSO_ENABLED === '1') {
  if (!config.SSO_PROVIDER) {
    errors.push('SSO_ENABLED=1 时，SSO_PROVIDER 必须配置');
  }
  
  if (config.SSO_PROVIDER === 'a8') {
    if (!config.A8_SERVER_URL) {
      errors.push('SSO_PROVIDER=a8 时，A8_SERVER_URL 必须配置');
    }
    if (!config.A8_API_USERNAME || !config.A8_API_PASSWORD) {
      warnings.push('A8_API_USERNAME 或 A8_API_PASSWORD 未配置（自动创建用户功能将不可用）');
    }
  } else {
    if (!config.SSO_LOGIN_URL) {
      errors.push('SSO_ENABLED=1 时，SSO_LOGIN_URL 必须配置');
    }
    if (!config.SSO_VERIFY_URL) {
      errors.push('SSO_ENABLED=1 时，SSO_VERIFY_URL 必须配置');
    }
    if (!config.SSO_CLIENT_ID || !config.SSO_CLIENT_SECRET) {
      warnings.push('SSO_CLIENT_ID 或 SSO_CLIENT_SECRET 未配置（OAuth2流程将无法完成）');
    }
  }
}

if (errors.length > 0) {
  console.error('\n❌ 配置错误（必须修复）：');
  errors.forEach((err, i) => console.error(`   ${i + 1}. ${err}`));
}

if (warnings.length > 0) {
  console.warn('\n⚠️  配置警告（建议修复）：');
  warnings.forEach((warn, i) => console.warn(`   ${i + 1}. ${warn}`));
}

if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ 所有必填配置项都已正确填写');
}

// 4. 测试连接
if (config.SSO_ENABLED === '1') {
  console.log('\n🌐 4. 测试SSO提供商连接...');
  
  if (config.SSO_PROVIDER === 'a8' && config.A8_SERVER_URL) {
    testA8Connection(config);
  } else if (config.SSO_LOGIN_URL) {
    testOAuth2Connection(config);
  }
} else {
  console.log('\n⏭️  跳过连接测试（SSO_ENABLED=0）');
}

// 5. 生成配置报告
console.log('\n📊 5. 生成配置报告...');
const report = {
  timestamp: new Date().toISOString(),
  sso_enabled: config.SSO_ENABLED === '1',
  sso_provider: config.SSO_PROVIDER,
  config_complete: errors.length === 0,
  config_valid: errors.length === 0 && warnings.length === 0,
  errors: errors,
  warnings: warnings,
  next_steps: []
};

if (!config.SSO_ENABLED || config.SSO_ENABLED === '0') {
  report.next_steps.push('启用SSO：设置 SSO_ENABLED=1');
}

if (config.SSO_PROVIDER === 'a8' && !config.A8_SERVER_URL) {
  report.next_steps.push('配置A8服务器地址：设置 A8_SERVER_URL=http://your-a8-server/seeyon');
}

if (config.SSO_PROVIDER !== 'a8' && !config.SSO_LOGIN_URL) {
  report.next_steps.push('配置SSO登录地址：设置 SSO_LOGIN_URL=http://your-oa-system/oauth2/authorize');
}

if (errors.length === 0) {
  report.next_steps.push('启动服务：npm start');
  report.next_steps.push('测试SSO登录：访问 http://localhost:3001/login 点击SSO登录按钮');
}

console.log('\n📋 配置报告：');
console.log(JSON.stringify(report, null, 2));

// 保存报告到文件
const reportPath = path.join(__dirname, 'sso-config-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`\n💾 报告已保存到：${reportPath}`);

console.log('\n' + '='.repeat(60));
if (errors.length === 0) {
  console.log('✅ 配置验证通过！');
  if (config.SSO_ENABLED === '1') {
    console.log('   可以启动服务测试SSO登录功能了。');
  } else {
    console.log('   如需启用SSO，请设置 SSO_ENABLED=1');
  }
} else {
  console.log('❌ 配置验证失败，请修复上述错误后重新运行测试。');
}
console.log('='.repeat(60) + '\n');

process.exit(errors.length > 0 ? 1 : 0);

// ============ 辅助函数 ============

function testA8Connection(config) {
  console.log(`   测试A8服务器连接：${config.A8_SERVER_URL}`);
  
  const url = new URL(config.A8_SERVER_URL);
  const client = url.protocol === 'https:' ? https : http;
  
  const testUrl = `${config.A8_SERVER_URL}/rest/orgMember/view/-1`;
  console.log(`   测试URL：${testUrl}`);
  
  const auth = Buffer.from(`${config.A8_API_USERNAME}:${config.A8_API_PASSWORD}`).toString('base64');
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: '/seeyon/rest/orgMember/view/-1',
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json'
    },
    timeout: 5000
  };
  
  const req = client.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('   ✅ A8服务器连接成功！');
        try {
          const json = JSON.parse(data);
          console.log(`   响应：`, JSON.stringify(json).substring(0, 100) + '...');
        } catch (e) {
          console.log(`   响应长度：${data.length} 字符`);
        }
      } else {
        console.error(`   ❌ A8服务器返回错误：${res.statusCode}`);
        console.error(`   响应：`, data.substring(0, 200));
      }
    });
  });
  
  req.on('error', (err) => {
    console.error(`   ❌ A8服务器连接失败：${err.message}`);
    console.log('\n   可能的原因：');
    console.log('   1. A8服务器地址错误');
    console.log('   2. A8服务器未启动');
    console.log('   3. 网络连接问题');
    console.log('   4. 防火墙阻止访问');
  });
  
  req.on('timeout', () => {
    console.error('   ❌ 连接超时（5秒）');
    req.destroy();
  });
  
  req.end();
}

function testOAuth2Connection(config) {
  console.log(`   测试OAuth2服务器连接：${config.SSO_LOGIN_URL}`);
  
  const url = new URL(config.SSO_LOGIN_URL);
  const client = url.protocol === 'https:' ? https : http;
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'GET',
    timeout: 5000
  };
  
  const req = client.request(options, (res) => {
    console.log(`   ✅ OAuth2服务器可访问（状态码：${res.statusCode}）`);
    if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) {
      console.log('   ✅ OAuth2登录页面可正常访问');
    } else {
      console.warn(`   ⚠️  Unexpected status code: ${res.statusCode}`);
    }
  });
  
  req.on('error', (err) => {
    console.error(`   ❌ OAuth2服务器连接失败：${err.message}`);
  });
  
  req.on('timeout', () => {
    console.error('   ❌ 连接超时（5秒）');
    req.destroy();
  });
  
  req.end();
}
