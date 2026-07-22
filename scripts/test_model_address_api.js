// 模型设置 - Ollama 服务地址配置端到端测试
// 验证：GET /config 含 ollama.baseUrl；POST 修改后热生效+持久化；/models/status 含 ollama；reset 回默认
const http = require('http');
const BASE = 'http://localhost:3001';

function req(method, path, token, data) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const body = data ? JSON.stringify(data) : null;
    const options = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    };
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);
    const r = http.request(options, (res) => {
      let buf = ''; res.on('data', c => buf += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, json: JSON.parse(buf) }); } catch (e) { resolve({ status: res.statusCode, json: buf }); } });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, '→', detail); }
}

(async () => {
  // 登录
  const login = await req('POST', '/api/auth/login', null, { username: 'admin', password: 'admin123' });
  const token = login.json?.token;
  if (!token) { console.log('❌ 登录失败:', JSON.stringify(login.json)); process.exit(1); }

  // 1) GET /config 含 ollama.baseUrl
  const cfg = await req('GET', '/api/admin/models/config', token);
  const obDefault = cfg.json?.config?.ollama?.baseUrl;
  check('GET /config 返回 ollama.baseUrl', !!obDefault, obDefault);

  // 2) /models/status 含 ollama
  const st = await req('GET', '/api/admin/models/status', token);
  check('GET /status 含 config.ollama.baseUrl', !!st.json?.config?.ollama?.baseUrl, st.json?.config?.ollama?.baseUrl);

  // 3) POST 修改 ollama.baseUrl（改端口验证热生效）
  const NEW = 'http://172.17.6.18:12345';
  const save = await req('POST', '/api/admin/models/config', token, { config: { ollama: { baseUrl: NEW } } });
  check('POST /config 修改 ollama 成功', save.json?.success === true, JSON.stringify(save.json));

  // 4) 热生效 + 持久化
  const cfg2 = await req('GET', '/api/admin/models/config', token);
  check('热生效: 配置中 ollama.baseUrl = 新值', cfg2.json?.config?.ollama?.baseUrl === NEW, cfg2.json?.config?.ollama?.baseUrl);
  const fs = require('fs');
  const onDisk = JSON.parse(fs.readFileSync('D:/Clow/projects/smart-customer-service/server/data/model-config.json', 'utf8'));
  check('持久化: model-config.json.ollama.baseUrl = 新值', onDisk.ollama?.baseUrl === NEW, onDisk.ollama?.baseUrl);
  // 后端运行时访问器应反映新地址
  const ms = require('D:/Clow/projects/smart-customer-service/server/model-switcher');
  check('后端 getOllamaBaseUrl() = 新值', ms.getOllamaBaseUrl() === NEW, ms.getOllamaBaseUrl());

  // 5) 非法地址应被拦截
  const bad = await req('POST', '/api/admin/models/config', token, { config: { ollama: { baseUrl: 'ftp://x' } } });
  check('非法地址被拦截', bad.json?.success === false, JSON.stringify(bad.json));
  const cfg3 = await req('GET', '/api/admin/models/config', token);
  check('非法地址未入库（仍为 NEW）', cfg3.json?.config?.ollama?.baseUrl === NEW, cfg3.json?.config?.ollama?.baseUrl);

  // 6) reset 回默认
  const reset = await req('POST', '/api/admin/models/config/reset', token);
  check('reset 成功', reset.json?.success === true, JSON.stringify(reset.json));
  const cfg4 = await req('GET', '/api/admin/models/config', token);
  check('reset 后 ollama.baseUrl = 默认', cfg4.json?.config?.ollama?.baseUrl === obDefault, cfg4.json?.config?.ollama?.baseUrl);

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
