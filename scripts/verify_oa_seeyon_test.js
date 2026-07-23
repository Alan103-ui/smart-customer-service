'use strict';
const http = require('http');
const BASE = 'http://localhost:3001';
let token = '';

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost', port: 3001, path, method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
    };
    if (token) opts.headers.Authorization = 'Bearer ' + token;
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => (chunks += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(chunks); } catch (e) {}
        resolve({ status: res.statusCode, text: chunks, json });
      });
    });
    req.on('error', (e) => resolve({ status: 0, text: e.message, json: null }));
    req.setTimeout(30000, () => { req.destroy(); resolve({ status: 0, text: 'timeout', json: null }); });
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const r = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  token = r.json && r.json.token;
  if (!token) { console.error('登录失败', r.text); process.exit(1); }
  console.log('登录成功');

  // Ensure seeyon mode with username/password
  const save = await request('POST', '/api/admin/oa/config', {
    enabled: true, baseUrl: 'http://172.17.6.4:60099', username: 'GK010172', apiType: 'seeyon'
  });
  console.log('保存 seeyon 配置:', save.json);

  const test = await request('POST', '/api/admin/oa/test');
  console.log('测试连接结果:', test.status, test.json);
  if (test.json && test.json.success) {
    console.log('✅ OA 内置适配器测试通过，组织数:', test.json.orgCount);
  } else {
    console.error('❌ 测试失败:', test.json && test.json.message);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
