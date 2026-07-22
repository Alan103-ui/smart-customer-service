// 数据备份接口端到端验证
const http = require('http');
let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name, detail ? '(' + detail + ')' : ''); }
  else { fail++; console.log('  ❌', name, detail ? '(' + detail + ')' : ''); }
}
function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);
    const r = http.request({ host: 'localhost', port: 3001, path: p, method, headers }, (res) => {
      let c = ''; res.on('data', x => c += x);
      res.on('end', () => { let j; try { j = JSON.parse(c); } catch (e) { j = c; } resolve({ status: res.statusCode, json: j }); });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}
async function main() {
  const login = await req('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  const token = login.json && login.json.token;
  assert('登录获取 token', !!token);
  if (!token) { console.log('EXIT 无 token'); process.exit(2); }

  // 1. 待备份文件清单
  const files = await req('GET', '/api/admin/backup/files', null, token);
  assert('GET /backup/files 成功', files.status === 200 && files.json.success);
  assert('含核心数据文件(faq/personnel/vector-store)', ['faq.json', 'personnel.json', 'vector-store.json'].every(f => (files.json.files || []).some(x => x.name === f)), 'count=' + (files.json.files || []).length);

  // 2. 立即备份
  const create = await req('POST', '/api/admin/backup/create', null, token);
  assert('POST /backup/create 成功', create.status === 200 && create.json.success);
  const bid = create.json.manifest && create.json.manifest.id;
  assert('返回备份 id', !!bid, bid);
  assert('备份包含多文件', create.json.manifest && create.json.manifest.files.length >= 5, 'files=' + (create.json.manifest && create.json.manifest.files.length));

  // 3. 备份历史可见
  const list = await req('GET', '/api/admin/backup/list', null, token);
  assert('GET /backup/list 成功', list.status === 200 && list.json.success);
  assert('历史含刚创建的备份', (list.json.backups || []).some((b) => b.id === bid));

  // 4. 恢复（同源恢复，应为幂等，文件数>0）
  const restore = await req('POST', '/api/admin/backup/restore', { id: bid }, token);
  assert('POST /backup/restore 成功', restore.status === 200 && restore.json.success);
  assert('恢复文件数>0', restore.json.count > 0, 'count=' + restore.json.count);

  // 5. 配置读取与保存
  const cfg0 = await req('GET', '/api/admin/backup/config', null, token);
  assert('GET /backup/config 成功', cfg0.status === 200 && cfg0.json.success);
  const cfgSave = await req('PUT', '/api/admin/backup/config', { enabled: true, retention: 10 }, token);
  assert('PUT /backup/config 保存成功', cfgSave.status === 200 && cfgSave.json.success && cfgSave.json.config.enabled === true && cfgSave.json.config.retention === 10);

  // 6. 删除测试备份（复位）
  const del = await req('DELETE', '/api/admin/backup/' + encodeURIComponent(bid), null, token);
  assert('DELETE /backup/:id 删除成功', del.status === 200 && del.json.success);
  const list2 = await req('GET', '/api/admin/backup/list', null, token);
  assert('删除后历史不含该备份', !(list2.json.backups || []).some((b) => b.id === bid));

  // 复位配置为默认（不打扰现有部署习惯）
  await req('PUT', '/api/admin/backup/config', { enabled: false, retention: 30 }, token);

  console.log('\n========== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch(e => { console.error('异常:', e); process.exit(2); });
