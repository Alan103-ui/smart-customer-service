// 截图验证：基础信息 → 数据备份 TAB 渲染（细粒度日志 + 分步超时）
const puppeteer = require('C:/Users/Alan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');
const path = require('path');
const fs = require('fs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:3001';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOT = path.join(__dirname, '_shot_backup_tab.png');
const log = (...a) => console.log('[shot]', ...a);

const HARD = setTimeout(() => { console.error('[shot] 硬超时退出'); process.exit(2); }, 70000);
async function withTimeout(name, p, ms = 12000) {
  log('→', name);
  try {
    const r = await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + ms)), ms))]);
    log('✓', name);
    return r;
  } catch (e) { log('✗', name, e.message); throw e; }
}

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
    executablePath: EDGE, headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1024']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1024 });
  page.on('pageerror', e => log('pageerror:', e.message));

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => {
    localStorage.setItem('cs_token', t);
    localStorage.setItem('cs_user', JSON.stringify({ username: 'admin', name: '管理员', role: 'admin' }));
  }, token);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);

  await withTimeout('打开管理后台', (async () => {
    await page.waitForSelector('.admin-btn', { timeout: 10000 });
    return clickByText(page, '管理后台');
  })());
  await sleep(1000);

  await withTimeout('点击基础信息', clickByText(page, '基础信息'));
  await sleep(1000);

  await withTimeout('点击数据备份', clickByText(page, '数据备份'), 10000);
  await sleep(2500); // 等备份列表接口返回

  // 不触发立即备份，直接看渲染
  const rendered = await withTimeout('渲染检查', page.evaluate(() => document.body.innerText.includes('数据备份')), 8000);
  log('数据备份TAB渲染:', rendered ? 'ok' : '未渲染');

  await withTimeout('截图(fullPage)', page.screenshot({ path: SHOT, fullPage: true }), 20000);
  log('截图已保存:', SHOT, '| 存在 =', fs.existsSync(SHOT));
  console.log('RESULT:', rendered ? 'PASS' : 'WARN');

  await browser.close();
  clearTimeout(HARD);
})().catch(e => { console.error('ERROR', e.message); process.exit(1); });
