// 验证「意图纠错 -> 反哺分类器」闭环是否真跑通
//   A. 单元级：规则路径（确定性，不调 LLM）—— 证明 addCorrection 后 classify 能立即吃到纠错规则
//   B. HTTP 级：通过运行中的守护进程接口，证明数据管线（纠错落库 -> 自动沉淀 -> 反馈统计可见）
//   C. 清理测试数据并复位
const path = require('path');
const fs = require('fs');
const http = require('http');

const SERVER_DIR = path.join(__dirname, '..', 'server');
const DATA_DIR = path.join(SERVER_DIR, '..', 'data');
const CORRECTIONS_PATH = path.join(DATA_DIR, 'intent-corrections.json');
const FEEDBACK_PATH = path.join(DATA_DIR, 'intent-feedback.json');

const RULE_QUERY = '【验证专用】我们的门禁卡丢了怎么办';
const FRESHOT_QUERY = '【验证专用】年假余额怎么查';

let pass = 0, fail = 0;
function assert(name, cond, detail) {
  if (cond) { pass++; console.log('  ✅', name, detail ? '(' + detail + ')' : ''); }
  else { fail++; console.log('  ❌', name, detail ? '(' + detail + ')' : ''); }
}

function httpReq(method, p, body, token) {
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
  const feedback = require(path.join(SERVER_DIR, 'intent-feedback'));
  const { understandIntent } = require(path.join(SERVER_DIR, 'intent-understanding'));

  // 清理本脚本可能残留的测试数据
  for (const q of [RULE_QUERY, FRESHOT_QUERY]) {
    const { items } = feedback.listCorrections({ search: '【验证专用】' });
    for (const it of items) feedback.deleteCorrection(it.id);
  }

  // ============ A. 单元级：规则路径（不调 LLM）============
  console.log('\n=== A. 单元级：addCorrection -> 自动沉淀 -> understandIntent 命中纠错规则 ===');
  assert('初始纠错文件为空', JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf8')).length === 0);

  const rec = feedback.addCorrection({
    source: 'admin', userMessage: RULE_QUERY,
    originalIntent: { level1: 'query', level2: null, confidence: 0.5 },
    correctedIntent: { level1: 'query', level2: 'operation' },
    correctedBy: 'verify', makeRule: true
  });
  assert('addCorrection 返回记录', !!(rec && rec.id), rec && rec.id);
  assert('纠错已落盘 intent-corrections.json', JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf8')).some(c => c.userMessage === RULE_QUERY));

  // addCorrection 内部已自动 applyFeedback
  const fb = feedback._loadFeedback();
  assert('自动沉淀生成确定性规则', fb.rules.some(r => r.keyword === RULE_QUERY), 'rules=' + fb.rules.length);
  assert('few-shot 同时包含该问题', fb.fewShot.some(e => e.query === RULE_QUERY), 'fewShot=' + fb.fewShot.length);

  // 关键：用 classify 同一问题，应命中纠错规则（fromCorrection），不调 LLM
  const t0 = Date.now();
  const result = await understandIntent(RULE_QUERY);
  const dt = Date.now() - t0;
  assert('understandIntent 命中纠错规则(fromCorrection)', result && result.fromCorrection === true, 'fromCorrection=' + (result && result.fromCorrection));
  assert('返回意图正确', result && result.primaryIntent.level1 === 'query' && result.primaryIntent.level2 === 'operation', JSON.stringify(result && result.primaryIntent));
  assert('置信度为规则值 0.97', result && result.primaryIntent.confidence === 0.97, 'conf=' + (result && result.primaryIntent && result.primaryIntent.confidence));
  console.log('    classify 耗时 ' + dt + 'ms（远低于 LLM 90s 超时 => 确认未走 LLM，规则直出）');

  // few-shot 分支：单条未标规则 -> 仅进 few-shot，不成规则
  feedback.addCorrection({
    source: 'admin', userMessage: FRESHOT_QUERY,
    originalIntent: { level1: 'query', level2: null },
    correctedIntent: { level1: 'query', level2: 'data' },
    correctedBy: 'verify', makeRule: false
  });
  const fb2 = feedback._loadFeedback();
  assert('few-shot 注入含新问题', fb2.fewShot.some(e => e.query === FRESHOT_QUERY), 'fewShot=' + fb2.fewShot.length);
  assert('单条未标规则 => 不生成规则', !fb2.rules.some(r => r.keyword === FRESHOT_QUERY), 'rules=' + fb2.rules.length);

  // 清理单元数据并复位
  for (const q of [RULE_QUERY, FRESHOT_QUERY]) {
    const { items } = feedback.listCorrections({ search: '【验证专用】' });
    for (const it of items) feedback.deleteCorrection(it.id);
  }
  feedback.applyFeedback();
  const reset = feedback._loadFeedback();
  assert('单元数据清理后反馈复位', reset.rules.length === 0 && reset.fewShot.length === 0);

  // ============ B. HTTP 级：运行中的守护进程数据管线 ============
  console.log('\n=== B. HTTP 级：守护进程 /api/admin/intent-correct + /intent-feedback/stats ===');
  const login = await httpReq('POST', '/api/auth/login', { username: 'admin', password: 'admin123' });
  if (!login.json || !login.json.token) { console.log('  ⚠️ 登录失败，跳过 HTTP 验证'); return; }
  const token = login.json.token;

  const statsBefore = await httpReq('GET', '/api/admin/intent-feedback/stats', null, token);
  const beforeRules = (statsBefore.json && statsBefore.json.stats && statsBefore.json.stats.feedback.ruleCount) || 0;

  const add = await httpReq('POST', '/api/admin/intent-correct', {
    userMessage: RULE_QUERY,
    originalIntent: { level1: 'query', level2: null, confidence: 0.5 },
    correctedIntent: { level1: 'query', level2: 'operation' },
    makeRule: true, note: 'verify-script'
  }, token);
  assert('HTTP 新增纠错成功', add.status === 200 && add.json.success === true, 'status=' + add.status);

  const statsAfter = await httpReq('GET', '/api/admin/intent-feedback/stats', null, token);
  const afterRules = (statsAfter.json && statsAfter.json.stats && statsAfter.json.stats.feedback.ruleCount) || 0;
  assert('守护进程自动沉淀使 ruleCount 增加', afterRules > beforeRules, beforeRules + ' -> ' + afterRules);
  const listR = await httpReq('GET', '/api/admin/intent-corrections?search=' + encodeURIComponent('【验证专用】'), null, token);
  const testIds = (listR.json && listR.json.items ? listR.json.items : []).map(i => i.id);
  assert('守护进程纠错已落库', testIds.length >= 1, 'ids=' + testIds.length);

  // 清理：删除测试纠错并重新沉淀（复位反馈文件）
  for (const id of testIds) { await httpReq('DELETE', '/api/admin/intent-corrections/' + id, null, token); }
  await httpReq('POST', '/api/admin/intent-feedback/apply', null, token);
  const statsFinal = await httpReq('GET', '/api/admin/intent-feedback/stats', null, token);
  const finalRules = (statsFinal.json && statsFinal.json.stats && statsFinal.json.stats.feedback.ruleCount) || 0;
  assert('HTTP 清理后 ruleCount 复位为 0', finalRules === 0, 'finalRules=' + finalRules);
  assert('intent-corrections.json 复位为空', JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf8')).length === 0);

  console.log('\n========== 结果: ' + pass + ' 通过 / ' + fail + ' 失败 ==========');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error('验证脚本异常:', e); process.exit(2); });
