/**
 * 模型设置 API 端到端测试
 * - 先以默认管理员 admin/admin123 登录获取令牌
 * - GET  /api/admin/models/config
 * - GET  /api/admin/models/status （应含完整 reranker.serviceUrl）
 * - POST /api/admin/models/config （写入 llm.primary 并热生效）
 * - 回滚配置
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
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;
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
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}  ${extra || ''}`); }
}

(async () => {
  console.log('=== 模型设置 API 测试 ===');

  // 登录获取令牌
  const login = await req('POST', null, '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (login.status !== 200 || !login.json?.token) {
    console.log('  ❌ 登录失败: ' + JSON.stringify(login.json));
    process.exit(1);
  }
  const TOKEN = login.json.token;
  console.log('  ✅ 登录成功，已获取令牌');

  // 1) GET config
  const cfg = await req('GET', TOKEN, '/api/admin/models/config');
  check('GET /models/config 200', cfg.status === 200, `status=${cfg.status}`);
  check('config 含 embedding/llm/reranker',
    cfg.json?.config?.embedding && cfg.json?.config?.llm && cfg.json?.config?.reranker,
    JSON.stringify(Object.keys(cfg.json?.config || {})));
  const origLLM = cfg.json?.config?.llm?.primary;

  // 2) GET status 应包含完整 reranker.serviceUrl
  const st = await req('GET', TOKEN, '/api/admin/models/status');
  check('GET /models/status 200', st.status === 200, `status=${st.status}`);
  check('status.config.reranker.serviceUrl 存在',
    !!st.json?.config?.reranker?.serviceUrl,
    st.json?.config?.reranker?.serviceUrl);
  check('status.currentModels.llm 存在', !!st.json?.currentModels?.llm, st.json?.currentModels?.llm);

  // 3) POST config 修改 llm.primary 并热生效
  const NEW = 'qwen3.5:9b-test';
  const post = await req('POST', TOKEN, '/api/admin/models/config', { config: { llm: { primary: NEW } } });
  check('POST /models/config 200', post.status === 200, `status=${post.status} body=${JSON.stringify(post.json)}`);
  check('返回 config.llm.primary 已更新', post.json?.config?.llm?.primary === NEW, post.json?.config?.llm?.primary);

  // 4) 验证热生效（服务器进程内 currentModels 与持久化文件均已更新）
  const st2 = await req('GET', TOKEN, '/api/admin/models/status');
  check('热生效: status.currentModels.llm = 新值', st2.json?.currentModels?.llm === NEW, st2.json?.currentModels?.llm);
  const persisted = JSON.parse(fs.readFileSync(path.join(__dirname, '../server/data/model-config.json'), 'utf8'));
  check('热生效: model-config.json 持久化 llm.primary', persisted.llm?.primary === NEW, persisted.llm?.primary);

  // 5) 回滚
  const revert = await req('POST', TOKEN, '/api/admin/models/config', { config: { llm: { primary: origLLM } } });
  check('回滚 POST 200', revert.status === 200, `status=${revert.status}`);
  const st3 = await req('GET', TOKEN, '/api/admin/models/status');
  check('回滚后 currentModels.llm 恢复', st3.json?.currentModels?.llm === origLLM, st3.json?.currentModels?.llm);

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
