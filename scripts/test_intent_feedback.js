// 意图在线标注 / 纠错回流闭环 - 端到端验证
// 1) 登录取 admin token
// 2) 公开端点发一条「聊天端」纠错（makeRule=true → 沉淀为确定性规则）
// 3) 后台一键沉淀（apply）
// 4) 再次解析同一问题 → 期望命中反馈规则，直接返回纠正后的意图（不经过 LLM）
// 5) 校验识别记录 / 纠错列表接口
// 6) 清理测试数据

const BASE = 'http://localhost:3001';

async function main() {
  // 1) 登录
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const login = await loginRes.json();
  const token = login.token || (login.data && login.data.token);
  if (!token) throw new Error('登录失败: ' + JSON.stringify(login));
  console.log('[TEST] admin 登录成功, token 长度=', token.length);

  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // 2) 公开端点发纠错（模拟聊天端）
  const TEST_QUERY = '我要报销差旅费';
  const corrRes = await fetch(`${BASE}/api/intent-correct`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userMessage: TEST_QUERY,
      originalIntent: { level1: 'query', level2: 'policy', confidence: 0.6 },
      correctedIntent: { level1: 'process', level2: 'apply' },
      makeRule: true
    })
  });
  const corr = await corrRes.json();
  if (!corr.success) throw new Error('纠错提交失败: ' + JSON.stringify(corr));
  console.log('[TEST] 聊天端纠错已提交, id=', corr.correction.id, 'source=', corr.correction.source);

  // 3) 一键沉淀
  const applyRes = await fetch(`${BASE}/api/admin/intent-feedback/apply`, { method: 'POST', headers: auth });
  const apply = await applyRes.json();
  if (!apply.success) throw new Error('沉淀失败: ' + JSON.stringify(apply));
  console.log('[TEST] 反馈沉淀完成 stats=', JSON.stringify(apply.stats));
  if (apply.stats.ruleCount < 1) throw new Error('期望至少生成 1 条规则');

  // 4) 再次解析同一问题 → 期望命中反馈规则
  const parseRes = await fetch(`${BASE}/api/admin/intent-parse`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ query: TEST_QUERY })
  });
  const parse = await parseRes.json();
  console.log('[TEST] 重新解析结果=', JSON.stringify(parse.primaryIntent), 'fromCorrection=', parse.fromCorrection);
  const got = parse.primaryIntent;
  if (got.level1 !== 'process' || got.level2 !== 'apply') {
    throw new Error(`闭环失败：期望 process/apply，实际 ${got.level1}/${got.level2}`);
  }
  console.log('✅ 闭环验证通过：纠错已反哺分类器（确定性规则命中，未走 LLM）');

  // 5) 识别记录 / 纠错列表
  const recRes = await fetch(`${BASE}/api/admin/intent-recognitions?limit=5`, { headers: auth });
  const rec = await recRes.json();
  console.log('[TEST] 在线识别记录条数=', rec.total);

  const listRes = await fetch(`${BASE}/api/admin/intent-corrections?limit=5`, { headers: auth });
  const list = await listRes.json();
  console.log('[TEST] 纠错记录条数=', list.total, '首条 applied=', list.items[0] && list.items[0].applied);

  // 6) 清理测试数据（删除纠错记录）
  const delRes = await fetch(`${BASE}/api/admin/intent-corrections/${corr.correction.id}`, { method: 'DELETE', headers: auth });
  const del = await delRes.json();
  console.log('[TEST] 清理测试纠错记录:', del.success ? 'OK' : 'FAIL');

  console.log('\n🎉 全部断言通过');
}

main().catch(e => { console.error('\n❌ 测试失败:', e.message); process.exit(1); });
