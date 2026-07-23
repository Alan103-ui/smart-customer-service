'use strict';
const puppeteer = require('puppeteer-core');
const http = require('http');

const BASE = 'http://localhost:3001';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function login() {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ username: 'admin', password: 'admin123' });
    const req = http.request({ hostname: 'localhost', port: 3001, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
      let c = '';
      res.on('data', (x) => (c += x));
      res.on('end', () => { try { resolve(JSON.parse(c).token); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const token = await login();
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => { localStorage.setItem('cs_token', t); }, token);
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('button.tab-btn', { timeout: 20000 });

  // 进入基础信息
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button.tab-btn')).find(b => b.textContent && b.textContent.includes('基础信息'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 600));

  // 进入致远 OA 对接
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button.ui-tab')).find(b => b.textContent && b.textContent.includes('致远OA对接'));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // 截图：默认 seeyon 状态
  await page.screenshot({ path: 'scripts/_shot_oa_seeyon.png', fullPage: false });
  console.log('RESULT: seeyon screenshot OK');

  // 切换到 generic，展开 JSON 区域
  await page.select('select.ui-select', 'generic');
  await new Promise(r => setTimeout(r, 500));
  await page.screenshot({ path: 'scripts/_shot_oa_generic.png', fullPage: false });
  console.log('RESULT: generic screenshot OK');

  await browser.close();
  console.log('RESULT: PASS');
})();
