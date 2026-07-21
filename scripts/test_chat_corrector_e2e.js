// 聊天端「意图纠错」按钮端到端 UI 测试（puppeteer-core + Edge headless）
// 覆盖：发消息→流式→助手气泡意图标签→点击「意图纠错」→表单提交→后端纠错记录
const puppeteer = require('C:/Users/Alan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:3001';

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail !== undefined ? '→ ' + JSON.stringify(detail) : ''}`); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getToken() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const j = await r.json();
  return j.token || (j.data && j.data.token);
}
async function getCorrections(token) {
  const r = await fetch(`${BASE}/api/admin/intent-corrections`, { headers: { 'Authorization': 'Bearer ' + token } });
  return (await r.json()).items || [];
}
async function delCorrection(token, id) {
  await fetch(`${BASE}/api/admin/intent-corrections/${id}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } });
}

(async () => {
  const token = await getToken();
  if (!token) throw new Error('获取 token 失败');
  const H = { 'Authorization': 'Bearer ' + token };

  // 记录测试前已有的纠错记录 id，避免误删真实数据
  const beforeIds = new Set((await getCorrections(token)).map(c => c.id));

  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1000']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  // 注入登录态
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => {
    localStorage.setItem('cs_token', t);
    localStorage.setItem('cs_user', JSON.stringify({ username: 'admin', name: '管理员', role: 'admin' }));
  }, token);

  const Q = '成都明天天气怎么样';
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await page.waitForSelector('input.input-field-modern', { timeout: 10000 });

  // 输入并发送
  await page.evaluate(q => {
    const inp = document.querySelector('input.input-field-modern');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, q); inp.dispatchEvent(new Event('input', { bubbles: true }));
  }, Q);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /发送/.test(b.textContent || ''));
    if (btn) btn.click();
  });

  // 等助手气泡出现：意图标签 + 纠错按钮（流式结束）
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await sleep(500);
    ready = await page.evaluate(() => {
      const bubbles = document.querySelectorAll('.message-bubble-modern.assistant');
      if (!bubbles.length) return false;
      const last = bubbles[bubbles.length - 1];
      return !!last.querySelector('.message-intent-modern')
        && !document.querySelector('.typing-indicator-modern')
        && !document.querySelector('.stream-cursor-modern')
        && !!last.querySelector('.message-correct-btn');
    });
    if (ready) break;
  }
  check('助手气泡含意图标签且出现「意图纠错」按钮', ready);

  // 点击纠错按钮
  await page.evaluate(() => {
    const bubbles = document.querySelectorAll('.message-bubble-modern.assistant');
    const btn = bubbles[bubbles.length - 1].querySelector('.message-correct-btn');
    if (btn) btn.click();
  });
  let panelShown = false;
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    panelShown = await page.evaluate(() => !!document.querySelector('.message-correct-panel .intent-corrector'));
    if (panelShown) break;
  }
  check('点击后弹出纠错表单（IntentCorrector）', panelShown);

  // 选择 correctedIntent：一级=process，二级=query_status
  await page.evaluate(() => {
    const s = document.querySelectorAll('.message-correct-panel .intent-corrector select');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s[0], 'process'); s[0].dispatchEvent(new Event('change', { bubbles: true }));
  });
  await sleep(400);
  await page.evaluate(() => {
    const s = document.querySelectorAll('.message-correct-panel .intent-corrector select');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(s[1], 'query_status'); s[1].dispatchEvent(new Event('change', { bubbles: true }));
  });
  // 勾选"沉淀为确定性规则"
  await page.evaluate(() => {
    const cb = document.querySelector('.message-correct-panel .intent-corrector input[type=checkbox]');
    if (cb && !cb.checked) cb.click();
  });
  await sleep(200);

  // 提交
  await page.evaluate(() => {
    const btn = document.querySelector('.message-correct-panel .intent-corrector .ic-submit');
    if (btn) btn.click();
  });
  let corrected = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    corrected = await page.evaluate(() => !!document.querySelector('.message-corrected-modern'));
    if (corrected) break;
  }
  check('提交后气泡显示「✓ 已纠错」', corrected);

  // 后端验证纠错记录已落库
  const items = await getCorrections(token);
  const created = items.filter(c => !beforeIds.has(c.id));
  check('后台新增 1 条纠错记录', created.length >= 1, { createdCount: created.length });
  const rec = created[0];
  console.log('  纠错记录:', JSON.stringify(rec));
  check('记录 userMessage 与输入框一致', rec && rec.userMessage === Q, rec && rec.userMessage);
  check('记录 correctedIntent.level1 = process', rec && rec.correctedIntent && rec.correctedIntent.level1 === 'process', rec && rec.correctedIntent);
  check('记录 correctedIntent.level2 = query_status', rec && rec.correctedIntent && rec.correctedIntent.level2 === 'query_status', rec && rec.correctedIntent);

  // 清理：仅删除本次新增记录
  for (const c of created) { await delCorrection(token, c.id); }
  console.log(`[cleanup] 删除测试新增纠错记录 ${created.length} 条`);

  await browser.close();
  console.log(`\n==== 聊天端纠错按钮 E2E：通过 ${pass} / 失败 ${fail} ====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('❌ 异常:', e.message); process.exit(2); });
