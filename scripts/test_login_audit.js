// 验证登录/登出审计埋点 + 分组排序逻辑
const BASE = 'http://localhost:3001';
const API = '/api/admin';

function req(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const lib = require('http');
    const u = new URL(url);
    const r = lib.request(u, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null }); } catch (e) { resolve({ status: res.statusCode, data: body }); } });
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

(async () => {
  let pass = true;
  const assert = (cond, msg) => { console.log(`${cond ? '✅' : '❌'} ${msg}`); if (!cond) pass = false; };

  // 1) 错误密码登录 → 应 401 且产生 login_failure
  const fail = await req(`${BASE}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'wrong-pwd' }) });
  assert(fail.status === 401, `错误密码登录返回 401 (实际 ${fail.status})`);

  // 2) 正确登录 → 应 200 且产生 login_success
  const ok = await req(`${BASE}/api/auth/login`, { method: 'POST', body: JSON.stringify({ username: 'admin', password: 'admin123' }) });
  assert(ok.status === 200 && ok.data && ok.data.token, `正确登录返回 token (状态 ${ok.status})`);
  const token = ok.data ? ok.data.token : null;

  // 3) 登出 → 应 200 且产生 logout
  let logoutStatus = null;
  if (token) {
    const lo = await req(`${BASE}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    logoutStatus = lo.status;
    assert(lo.status === 200, `登出接口返回 200 (实际 ${lo.status})`);
  } else {
    assert(false, '无 token 无法测登出');
  }

  // 等待日志落盘
  await new Promise(r => setTimeout(r, 800));

  // 4) 审计页应查到 login_success / login_failure / logout（operator=admin，需鉴权）
  const aud = await req(`${BASE}${API}/audit-logs?operator=admin&limit=2000`, { headers: { Authorization: `Bearer ${token}` } });
  const list = (aud.data && aud.data.data) || [];
  const ops = list.map(a => a.operation);
  assert(ops.includes('login_success'), `审计含 login_success (命中 ${ops.filter(o => o === 'login_success').length})`);
  assert(ops.includes('login_failure'), `审计含 login_failure (命中 ${ops.filter(o => o === 'login_failure').length})`);
  assert(ops.includes('logout'), `审计含 logout (命中 ${ops.filter(o => o === 'logout').length})`);

  // 5) 分组排序逻辑：按 operation 聚合后按计数降序
  const m = {};
  for (const a of list) { const k = a.operation || 'unknown'; (m[k] = m[k] || []).push(a); }
  const groups = Object.entries(m).sort((x, y) => y[1].length - x[1].length);
  let sortedDesc = true;
  for (let i = 1; i < groups.length; i++) if (groups[i][1].length > groups[i - 1][1].length) sortedDesc = false;
  assert(sortedDesc, `分组按计数降序 (${groups.length} 组, Top: ${groups.slice(0, 3).map(g => g[0] + '=' + g[1].length).join(', ')})`);

  // 6) 失败登录详情含 reason
  const failRec = list.find(a => a.operation === 'login_failure');
  assert(failRec && failRec.details && failRec.details.reason === 'wrong_password', `login_failure 详情含 reason=wrong_password`);

  console.log(pass ? '\n🎉 登录/登出审计 + 分组排序 e2e 全部通过' : '\n⚠️ 存在失败项');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('脚本异常', e); process.exit(1); });
