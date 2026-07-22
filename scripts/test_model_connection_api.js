// 测试「模型设置」TAB 的「测试连接」后端接口：POST /api/admin/models/test
// 覆盖：三类模型默认配置、带表单值实时探测、错误地址失败路径、非法 type
const BASE = 'http://localhost:3001';

async function getToken() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  return (await r.json()).token;
}

async function testConnection(token, body) {
  const r = await fetch(`${BASE}/api/admin/models/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  return { status: r.status, data: await r.json() };
}

(async () => {
  const token = await getToken();
  if (!token) { console.error('❌ 登录失败'); process.exit(1); }
  let pass = 0, fail = 0;
  const check = (name, cond, extra = '') => {
    if (cond) { console.log(`✅ ${name} ${extra}`); pass++; }
    else { console.log(`❌ ${name} ${extra}`); fail++; }
  };

  // 1. embedding 仅 type（测当前生效配置）
  let res = await testConnection(token, { type: 'embedding' });
  check('embedding 默认配置可达', res.data.success && res.data.available === true, `(resp ${res.data.responseTime}ms)`);

  // 2. llm 仅 type
  res = await testConnection(token, { type: 'llm' });
  check('llm 默认配置可达', res.data.success && res.data.available === true, `(resp ${res.data.responseTime}ms)`);

  // 3. reranker 仅 type
  res = await testConnection(token, { type: 'reranker' });
  check('reranker 默认配置可达', res.data.success && res.data.available === true, `(resp ${res.data.responseTime}ms)`);

  // 4. embedding 带表单值（primary + baseUrl）实时探测
  res = await testConnection(token, { type: 'embedding', primary: 'bge-m3:latest', baseUrl: 'http://172.17.6.18:11434' });
  check('embedding 带表单值可达', res.data.success && res.data.available === true, `(resp ${res.data.responseTime}ms)`);

  // 5. reranker 带 serviceUrl + timeout 实时探测
  res = await testConnection(token, { type: 'reranker', serviceUrl: 'http://172.17.6.18:8000/rerank', timeout: 10000 });
  check('reranker 带表单值可达', res.data.success && res.data.available === true, `(resp ${res.data.responseTime}ms)`);

  // 6. 失败路径：错误地址应返回 available=false
  res = await testConnection(token, { type: 'embedding', primary: 'bge-m3:latest', baseUrl: 'http://127.0.0.1:9' });
  check('embedding 错误地址应不可达', res.data.success && res.data.available === false, `(error: ${res.data.error})`);

  // 7. 非法 type 应 400
  res = await testConnection(token, { type: 'unknown' });
  check('非法 type 应 400', res.status === 400, `(status ${res.status})`);

  console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})();
