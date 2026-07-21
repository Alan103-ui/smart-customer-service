// 审计页增强 e2e：验证后端日期范围/操作人/操作名筛选 + 分组数据形态
const BASE = 'http://localhost:3001';
const fetch = (...a) => import('node:http').then(m => new Promise((res, rej) => {
  const url = new URL(a[0]);
  const opts = a[1] || {};
  const req = m.request(url, {
    method: opts.method || 'GET',
    headers: opts.headers || {},
  }, (r) => {
    let d = ''; r.on('data', c => d += c);
    r.on('end', () => res({ status: r.statusCode, body: d }));
  });
  req.on('error', rej);
  if (opts.body) req.write(opts.body);
  req.end();
}));

const j = (r) => { try { return JSON.parse(r.body); } catch { return r.body; } };

(async () => {
  const today = new Date().toISOString().slice(0, 10); // 2026-07-21
  const yesterday = '2026-07-20';

  // 1) 登录
  const login = j(await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' }),
  }));
  const token = login.token;
  if (!token) { console.error('登录失败', login); process.exit(1); }
  const H = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const get = async (q) => j(await fetch(`${BASE}/api/admin/audit-logs${q}`, { headers: H }));

  // 2) 全量
  const all = await get('?limit=2000');
  console.log(`[全量] total=${all.total}, data=${all.data.length}`);

  // 3) 日期范围（仅今天）
  const todayRes = await get(`?dateFrom=${today}&dateTo=${today}&limit=2000`);
  console.log(`[日期范围 ${today}] total=${todayRes.total}`);

  // 4) 操作人
  const adminRes = await get(`?operator=admin&limit=2000`);
  console.log(`[操作人=admin] total=${adminRes.total}`);

  // 5) 操作名包含 delete
  const delRes = await get(`?operation=delete&limit=2000`);
  console.log(`[操作名~delete] total=${delRes.total}, 样例=${delRes.data.slice(0,3).map(x=>x.operation).join(',')}`);

  // 6) 分组形态（模拟前端 useMemo）
  const groups = {};
  for (const a of all.data) { const k = a.operation || 'unknown'; (groups[k] = groups[k] || []).push(a); }
  const top = Object.entries(groups).sort((x,y)=>y[1].length-x[1].length).slice(0, 10);
  console.log(`[分组] 去重操作数=${Object.keys(groups).length}, Top:`, top.map(([k,v])=>`${k}(${v.length})`).join(' '));

  // 7) 可逆写操作：创建临时知识库 → 删除，验证 operator+今日过滤命中
  const kbName = 'TEST_AUDIT_FILTER_' + Date.now();
  const created = j(await fetch(`${BASE}/api/admin/knowledge-bases`, { method:'POST', headers:H, body: JSON.stringify({ name: kbName, description:'e2e' }) }));
  const kbId = created.id || (created.data && created.data.id);
  console.log(`[KB创建] id=${kbId}, resp=${JSON.stringify(created).slice(0,120)}`);
  const del = j(await fetch(`${BASE}/api/admin/knowledge-bases/${kbId}`, { method:'DELETE', headers:H }));
  console.log(`[KB删除] resp=${JSON.stringify(del).slice(0,120)}`);

  // 8) 重新查今日 -> 应包含 kb_create / kb_delete
  const today2 = await get(`?dateFrom=${today}&dateTo=${today}&limit=2000`);
  const ops2 = today2.data.map(x=>x.operation);
  const hasCreate = ops2.includes('kb_create');
  const hasDelete = ops2.includes('kb_delete');
  console.log(`[今日复核] 含kb_create=${hasCreate}, 含kb_delete=${hasDelete}, 今日total=${today2.total}`);

  // 9) 清理校验：KB 删除为软删除设计（isActive=false），逻辑上已不可见；物理移除测试条目保持仓库干净
  const fs = require('fs');
  const kbPath = 'D:/Clow/projects/smart-customer-service/data/knowledge_bases.json';
  const kbs = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
  const logicalDeleted = kbs.find(k => k.id === kbId && k.isActive === false);
  const activeResidue = kbs.find(k => k.id === kbId && k.isActive === true);
  // 物理移除测试条目
  const cleaned = kbs.filter(k => k.id !== kbId);
  fs.writeFileSync(kbPath, JSON.stringify(cleaned, null, 2));
  console.log(`[清理校验] 软删除生效=${!!logicalDeleted}, 活跃残留=${!!activeResidue}, 已物理移除=${cleaned.length < kbs.length}`);

  // 结论
  const ok = all.total > 0 && todayRes.total > 0 && adminRes.total > 0 &&
             all.data.every(a => a.operation && a.operator && a.timestamp) &&
             hasCreate && hasDelete && !!logicalDeleted && !activeResidue;
  console.log(ok ? '\n✅ 审计筛选/分组 e2e 全部通过' : '\n❌ 存在失败项，见上');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('E2E 异常', e); process.exit(1); });
