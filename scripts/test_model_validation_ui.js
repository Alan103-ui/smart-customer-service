// 前端表单校验实测：puppeteer-core + Edge headless
// 场景：清空 embedding 主模型 + 填写非法 reranker 服务地址 → 点保存
// 断言：被前端拦截（不弹 confirm）、出现 .ms-field-error 红色提示、输入框加 .rag-input-error
const puppeteer = require('C:/Users/Alan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getToken() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  return (await r.json()).token;
}
async function clickByText(page, keyword) {
  return page.evaluate((kw) => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes(kw));
    if (btn) { btn.click(); return true; }
    return false;
  }, keyword);
}

(async () => {
  const token = await getToken();
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1024']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024 });

  // 监控 confirm 弹窗：若前端未拦截则会弹出
  let dialogShown = false;
  page.on('dialog', async d => { dialogShown = true; await d.dismiss(); });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => {
    localStorage.setItem('cs_token', t);
    localStorage.setItem('cs_user', JSON.stringify({ username: 'admin', name: '管理员', role: 'admin' }));
  }, token);
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  await page.waitForSelector('.admin-btn', { timeout: 10000 }).then(() => clickByText(page, '管理后台')).catch(() => {});
  await sleep(1200);
  await clickByText(page, 'RAG 管理');
  await sleep(1200);
  await clickByText(page, '模型设置');
  await sleep(2200);

  // 清空 embedding 主模型（第一个 .rag-input）+ 填写非法 reranker 服务地址
  await page.evaluate(() => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    const inputs = Array.from(document.querySelectorAll('.rag-input'));
    const primary = inputs[0];
    if (primary) { setter.call(primary, ''); primary.dispatchEvent(new Event('input', { bubbles: true })); }
    const su = inputs.find(i => (i.placeholder || '').includes('rerank'));
    if (su) { setter.call(su, 'ftp://bad'); su.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  await sleep(300);

  // 点击保存
  await clickByText(page, '保存配置');
  await sleep(900);

  const errInfo = await page.evaluate(() => {
    const errs = Array.from(document.querySelectorAll('.ms-field-error')).map(e => e.textContent);
    const invalidCount = Array.from(document.querySelectorAll('.rag-input-error')).length;
    const notice = (document.querySelector('.toast-error') || {}).textContent || '';
    return { errs, invalidCount, notice };
  });
  console.log('错误提示:', JSON.stringify(errInfo.errs));
  console.log('红色错误输入框数:', errInfo.invalidCount);
  console.log('错误通知:', errInfo.notice);
  console.log('confirm 弹窗是否被拦截(未弹出):', !dialogShown);

  const pass =
    errInfo.errs.some(t => (t || '').includes('主模型')) &&
    errInfo.errs.some(t => (t || '').includes('服务地址') || (t || '').includes('格式应为')) &&
    errInfo.invalidCount >= 2 &&
    !dialogShown;
  console.log('RESULT:', pass ? 'PASS' : 'FAIL');

  await page.screenshot({ path: 'D:/Clow/projects/smart-customer-service/scripts/_shot_validation.png' });
  console.log('截图已保存: _shot_validation.png');
  await browser.close();
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERROR', e); process.exit(1); });
