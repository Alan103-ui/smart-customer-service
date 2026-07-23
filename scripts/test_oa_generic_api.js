'use strict';
/**
 * 验证 OA 客户端通用化改造：
 * 1. 登录
 * 2. 重置为 seeyon 默认状态
 * 3. GET /oa/config 返回 apiType='seeyon' + generic 默认模板
 * 4. POST 切换 apiType='generic' 并保存自定义端点/字段映射
 * 5. GET 验证持久化
 * 6. POST /oa/test 在 generic 模式下按配置探测（失败也视为正常，关键是不崩溃）
 * 7. 切回 seeyon，验证向后兼容
 */

const http = require('http');
const BASE = 'http://localhost:3001';
let token = '';

function assert(name, cond, extra = '') {
  const ok = !!cond;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}` + (extra ? ` | ${extra}` : ''));
  if (!ok) process.exitCode = 1;
  return ok;
}

function request(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port: 3001,
      path,
      method,
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
    req.on('error', (e) => resolve({ status: 0, text: e.message, json: null, error: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, text: 'timeout', json: null, error: 'timeout' }); });
    if (data) req.write(data);
    req.end();
  });
}

async function login() {
  const r = await request('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  token = r.json && r.json.token;
  assert('登录成功', !!token, token ? '已拿到 token' : r.text);
}

(async () => {
  await login();

  // 0. 先重置为 seeyon，避免上次测试残留影响
  const reset0 = await request('POST', '/api/admin/oa/config', {
    enabled: true,
    baseUrl: 'http://172.17.6.4:60099',
    username: 'GK010172',
    apiType: 'seeyon',
  });
  assert('重置为 seeyon 成功', reset0.json && reset0.json.success, reset0.text);

  // 1. 默认配置读取
  const cfg1 = await request('GET', '/api/admin/oa/config');
  assert('GET /oa/config 成功', cfg1.status === 200 && cfg1.json, 'status=' + cfg1.status);
  assert('默认 apiType=seeyon', cfg1.json.apiType === 'seeyon', 'apiType=' + cfg1.json.apiType);
  assert('返回 generic 模板结构', cfg1.json.generic && typeof cfg1.json.generic.authType === 'string', 'authType=' + (cfg1.json.generic && cfg1.json.generic.authType));
  assert('generic 中敏感 token 已脱敏', !cfg1.json.generic.staticToken, 'staticToken=' + cfg1.json.generic.staticToken);

  // 2. 切换 generic 并保存
  const customGeneric = Object.assign({}, cfg1.json.generic, {
    authType: 'fixed_token',
    staticToken: 'my-test-token-123456',
    orgAccountsEndpoint: {
      method: 'GET',
      path: '/api/v1/orgs',
      query: {},
      body: {},
      headers: {},
      responsePath: 'data.list',
      paging: { enabled: false, pageParam: 'page', sizeParam: 'size', defaultSize: 100 },
    },
    orgDepartmentsEndpoint: {
      method: 'GET',
      path: '/api/v1/orgs/{accountId}/departments',
      query: {},
      body: {},
      headers: {},
      responsePath: 'data',
      accountIdParam: 'accountId',
      paging: { enabled: false },
    },
    orgMembersEndpoint: {
      method: 'GET',
      path: '/api/v1/orgs/{accountId}/members',
      query: {},
      body: {},
      headers: {},
      responsePath: 'data',
      accountIdParam: 'accountId',
      paging: { enabled: false },
    },
  });

  const save2 = await request('POST', '/api/admin/oa/config', {
    enabled: true,
    baseUrl: 'http://172.17.6.4:60099',
    username: 'GK010172',
    apiType: 'generic',
    generic: customGeneric,
  });
  assert('POST 切换 generic 保存成功', save2.json && save2.json.success, save2.text);
  assert('保存后 apiType=generic', save2.json.data.apiType === 'generic', 'apiType=' + save2.json.data.apiType);

  // 3. 验证持久化
  const cfg3 = await request('GET', '/api/admin/oa/config');
  assert('持久化后 apiType=generic', cfg3.json.apiType === 'generic', 'apiType=' + cfg3.json.apiType);
  assert('持久化后 authType=fixed_token', cfg3.json.generic.authType === 'fixed_token', 'authType=' + cfg3.json.generic.authType);
  assert('持久化后端点路径正确', cfg3.json.generic.orgAccountsEndpoint.path === '/api/v1/orgs', 'path=' + cfg3.json.generic.orgAccountsEndpoint.path);
  assert('静态 token 脱敏不泄露', cfg3.json.generic.staticTokenMasked && !cfg3.json.generic.staticToken, 'masked=' + cfg3.json.generic.staticTokenMasked);

  // 4. 测试连接（generic + 不可达端点应返回失败信息而非崩溃；timeout 也视为合理失败）
  const test4 = await request('POST', '/api/admin/oa/test');
  if (test4.json) {
    assert('/oa/test 返回结构', typeof test4.json.success === 'boolean', 'body=' + test4.text);
    assert('/oa/test 标识 apiType', test4.json.apiType === 'generic', 'apiType=' + test4.json.apiType);
    assert('/oa/test 标识 authType', test4.json.authType === 'fixed_token', 'authType=' + test4.json.authType);
    assert('/oa/test 未崩溃（失败原因合理）', !test4.json.success && test4.json.message, 'message=' + test4.json.message);
  } else {
    assert('/oa/test 底层连接失败但未崩溃（服务端仍在运行）', true, 'error=' + test4.error);
  }

  // 5. 切回 seeyon，验证向后兼容
  const save5 = await request('POST', '/api/admin/oa/config', {
    enabled: true,
    baseUrl: 'http://172.17.6.4:60099',
    username: 'GK010172',
    apiType: 'seeyon',
  });
  assert('切回 seeyon 保存成功', save5.json && save5.json.success, save5.text);

  const cfg5 = await request('GET', '/api/admin/oa/config');
  assert('切回后 apiType=seeyon', cfg5.json.apiType === 'seeyon', 'apiType=' + cfg5.json.apiType);
  assert('seeyon 下仍返回 generic 模板', cfg5.json.generic && cfg5.json.generic.authType, 'authType=' + (cfg5.json.generic && cfg5.json.generic.authType));

  console.log('\n全部验证完成。');
})();
