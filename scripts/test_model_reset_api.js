/**
 * 模型配置 reset API 端到端测试
 * 覆盖：登录 → 读取原始配置 → 修改为非默认 → 确认已改 → reset → 确认回到部署基线 → 磁盘持久化
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3001';

function req(method, token, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const u = new URL(BASE + p);
    const options = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = 'Bearer ' + token;
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request(options, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); }
        catch (e) { resolve({ status: res.statusCode, json: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name + (extra !== undefined ? ' (got: ' + JSON.stringify(extra) + ')' : '')); }
}

(async () => {
  // 部署基线基准
  const def = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/model-config.default.json'), 'utf8'));

  // 登录
  const login = await req('POST', null, '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.json?.token || login.json?.data?.token;
  check('登录成功', !!token, login.json);
  if (!token) { console.log(`\n结果: ${pass} 通过, ${fail} 失败`); process.exit(1); }

  // 1) 原始配置
  const cfg0 = await req('GET', token, '/api/admin/models/config');
  check('读取原始配置', cfg0.json?.success, cfg0.json);
  console.log('    原始 llm.primary =', cfg0.json?.config?.llm?.primary);

  // 2) 改为非默认
  const mod = await req('POST', token, '/api/admin/models/config', { config: { llm: { primary: 'qwen3.5:9b' } } });
  check('POST 修改生效', mod.json?.success && mod.json?.config?.llm?.primary === 'qwen3.5:9b', mod.json);

  // 3) 确认已改
  const cfg1 = await req('GET', token, '/api/admin/models/config');
  check('GET 确认已改为 qwen3.5:9b', cfg1.json?.config?.llm?.primary === 'qwen3.5:9b', cfg1.json?.config?.llm?.primary);

  // 4) reset
  const reset = await req('POST', token, '/api/admin/models/config/reset');
  check('reset 成功', reset.json?.success, reset.json);

  // 5) 回到部署基线（API 返回）
  const cfg2 = await req('GET', token, '/api/admin/models/config');
  check('reset 后 llm.primary 回到部署基线', cfg2.json?.config?.llm?.primary === def.llm?.primary, cfg2.json?.config?.llm?.primary);
  check('reset 后 reranker.serviceUrl 回到部署基线', cfg2.json?.config?.reranker?.serviceUrl === def.reranker?.serviceUrl, cfg2.json?.config?.reranker?.serviceUrl);

  // 6) 磁盘持久化
  const cfgPath = path.join(__dirname, '../server/data/model-config.json');
  const onDisk = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  check('磁盘 model-config.json 回到部署基线', onDisk.llm?.primary === def.llm?.primary, onDisk.llm?.primary);

  console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
