// 意图闭环完整功能测试：基线识别 → 公开纠错 → apply → 命中规则 → 记录查询 → 删除
const BASE = 'http://localhost:3001';
const Q = '成都明天天气怎么样';

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const j = await r.json();
  if (!j.token) throw new Error('login failed: ' + JSON.stringify(j));
  return j.token;
}

async function call(path, opts) {
  const r = await fetch(`${BASE}${path}`, opts);
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail ? '→ ' + JSON.stringify(detail) : ''}`); }
}

(async () => {
  const token = await login();
  const H = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

  // 清理历史残留
  const before = await call('/api/admin/intent-corrections', { headers: H });
  const ids = (before.body.items || []).map(c => c.id);
  for (const id of ids) await call(`/api/admin/intent-corrections/${id}`, { method: 'DELETE', headers: H });

  console.log('\n[1] 基线识别（未纠错前）');
  const base = await call('/api/admin/intent-parse', { method: 'POST', headers: H, body: JSON.stringify({ query: Q }) });
  const baseL1 = base.body.primaryIntent && base.body.primaryIntent.level1;
  console.log('     →', JSON.stringify(base.body.primaryIntent));
  check('基线识别返回 level1', !!baseL1, base.body);
  check('基线识别未命中纠错规则（fromCorrection 应为 undefined）', base.body.fromCorrection === undefined, base.body);

  console.log('\n[2] 聊天端公开纠错接口（无 admin 鉴权也能用）');
  const corr = await call('/api/intent-correct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userMessage: Q, originalIntent: { level1: baseL1 }, correctedIntent: { level1: 'process', level2: 'query_status' }, makeRule: true })
  });
  check('公开纠错返回 success', corr.body.success === true, corr.body);
  check('纠错记录含 id', corr.body.correction && !!corr.body.correction.id, corr.body);
  const corrId = corr.body.correction && corr.body.correction.id;

  console.log('\n[3] 后台一键应用反馈沉淀');
  const apply = await call('/api/admin/intent-feedback/apply', { method: 'POST', headers: H });
  check('apply 成功', apply.body.success === true, apply.body);
  const stats = apply.body.stats || {};
  console.log('     stats =', JSON.stringify(stats));
  check('沉淀生成 ≥1 条确定性规则', stats.ruleCount >= 1, stats);
  check('沉淀生成 ≥1 条 few-shot 样例', stats.fewShotCount >= 1, stats);

  console.log('\n[4] 二次识别同一 query → 应命中纠错规则（绕过 LLM）');
  const re = await call('/api/admin/intent-parse', { method: 'POST', headers: H, body: JSON.stringify({ query: Q }) });
  console.log('     →', JSON.stringify(re.body.primaryIntent));
  check('命中纠错规则 fromCorrection=true', re.body.fromCorrection === true, re.body);
  check('纠正后意图为 process/query_status', re.body.primaryIntent && re.body.primaryIntent.level1 === 'process' && re.body.primaryIntent.level2 === 'query_status', re.body);
  check('规则置信度高 (≥0.95)', re.body.primaryIntent && re.body.primaryIntent.confidence >= 0.95, re.body);

  console.log('\n[5] 在线识别记录（来自 faq_logs）可查询');
  const rec = await call('/api/admin/intent-recognitions?limit=5', { headers: H });
  check('识别记录列表返回', Array.isArray(rec.body.items), rec.body);
  console.log('     最新一条:', JSON.stringify(rec.body.items && rec.body.items[0]));

  console.log('\n[6] 纠错记录列表');
  const list = await call('/api/admin/intent-corrections', { headers: H });
  check('纠错记录 ≥1 条', (list.body.items || []).length >= 1, list.body);

  console.log('\n[7] 删除纠错记录');
  const del = await call(`/api/admin/intent-corrections/${corrId}`, { method: 'DELETE', headers: H });
  check('删除成功', del.body.success === true, del.body);
  const list2 = await call('/api/admin/intent-corrections', { headers: H });
  check('删除后该条不再出现', !(list2.body.items || []).some(c => c.id === corrId), list2.body);

  console.log(`\n==== 结果：通过 ${pass} / 失败 ${fail} ====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('测试异常:', e); process.exit(2); });
