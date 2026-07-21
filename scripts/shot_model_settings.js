// 截图验证：RAG 管理 → 模型设置 TAB 渲染（puppeteer-core + Edge headless）
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
  if (!token) throw new Error('获取 token 失败');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1024']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024 });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => {
    localStorage.setItem('cs_token', t);
    localStorage.setItem('cs_user', JSON.stringify({ username: 'admin', name: '管理员', role: 'admin' }));
  }, token);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  // 进入管理后台
  const opened = await page.waitForSelector('.admin-btn', { timeout: 10000 }).then(() => clickByText(page, '管理后台')).catch(() => false);
  console.log('打开管理后台:', opened ? 'ok' : '未找到按钮');
  await sleep(1200);

  // 切到 RAG 管理
  await clickByText(page, 'RAG 管理');
  await sleep(1200);

  // 切到 模型设置
  await clickByText(page, '模型设置');
  await sleep(2000); // 等接口加载概览

  // 确认「已配置模型概览」已渲染
  const rendered = await page.evaluate(() => document.body.innerText.includes('已配置模型概览'));
  console.log('已配置模型概览渲染:', rendered ? 'ok' : '未渲染');

  // 滚动到底部，确保「恢复默认配置」按钮入镜
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('恢复默认配置'));
    if (btn) btn.scrollIntoView({ behavior: 'instant', block: 'center' });
    else window.scrollTo(0, document.body.scrollHeight);
  });
  await sleep(500);

  // 截图
  const out = 'D:/Clow/projects/smart-customer-service/scripts/_shot_model_settings.png';
  await page.screenshot({ path: out, fullPage: true });
  console.log('截图已保存:', out);
  console.log('RESULT:', rendered ? 'PASS' : 'WARN');

  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
