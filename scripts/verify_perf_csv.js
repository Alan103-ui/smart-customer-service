// 验证：PERF 性能视图渲染 + 对话明细 CSV 导出下载
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:3001';

const dlDir = path.join(__dirname, 'dl');
fs.mkdirSync(dlDir, { recursive: true });
// 清空旧下载
fs.readdirSync(dlDir).forEach(f => fs.unlinkSync(path.join(dlDir, f)));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clickByText = (page, text) => page.evaluate((t) => {
  const btn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes(t));
  if (btn) { btn.click(); return true; } return false;
}, text);

(async () => {
  const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', e => console.log('[pageerror]', e.message));

  // 登录
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.type('input[placeholder="请输入用户名"]', 'admin');
  await page.type('input[placeholder="请输入密码"]', 'admin123');
  await page.click('button[type="submit"]');
  await sleep(2500);
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ui-tabs', { timeout: 10000 }).catch(() => {});
  await sleep(800);
  console.log('[登录] 已进入 /admin');

  // ---- CSV 导出验证 ----
  await clickByText(page, '对话管理');
  await sleep(900);
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
  const clicked = await clickByText(page, '导出 CSV');
  console.log('[CSV] 点击导出按钮:', clicked);
  await sleep(2500);
  const csvs = fs.readdirSync(dlDir).filter(f => f.endsWith('.csv'));
  if (csvs.length) {
    const csv = fs.readFileSync(path.join(dlDir, csvs[0]), 'utf8');
    const lines = csv.split('\n').filter(Boolean);
    console.log('[CSV] 文件:', csvs[0], '| 行数:', lines.length, '| 首行:', lines[0]);
    console.log('[CSV] 含数据行:', lines.length > 1);
  } else {
    console.log('[CSV] ❌ 未生成文件');
  }

  // ---- PERF 视图验证 + 截图 ----
  await clickByText(page, '日志管理');
  await sleep(500);
  await clickByText(page, '性能');
  await sleep(3000); // 等 fetch 最新日志 + 渲染摘要
  // 检查性能摘要是否存在
  const perfInfo = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
      hasPerf: txt.includes('请求总数') && txt.includes('最慢路径'),
      hasStat: txt.includes('平均耗时') || txt.includes('P95'),
    };
  });
  console.log('[PERF] 摘要卡片渲染:', perfInfo.hasPerf, '| 统计项:', perfInfo.hasStat);
  await page.screenshot({ path: path.join(__dirname, 'perf_view.png') });
  console.log('[截图] perf_view.png 已生成');

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('ERR', e); process.exit(1); });
