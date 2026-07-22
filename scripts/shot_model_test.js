// 交互截图验证：模型设置 TAB 三个「测试连接」按钮 + 结果显示
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
async function clickTestInBlock(page, blockTitle) {
  return page.evaluate((title) => {
    const titles = Array.from(document.querySelectorAll('.ms-form-title'));
    const t = titles.find(el => (el.textContent || '').includes(title));
    if (!t) return false;
    const block = t.closest('.ms-form-block');
    const btn = block && Array.from(block.querySelectorAll('button')).find(b => (b.textContent || '').includes('测试连接'));
    if (btn) { btn.click(); return true; }
    return false;
  }, blockTitle);
}

(async () => {
  const token = await getToken();
  if (!token) throw new Error('获取 token 失败');
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,1200']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(t => {
    localStorage.setItem('cs_token', t);
    localStorage.setItem('cs_user', JSON.stringify({ username: 'admin', name: '管理员', role: 'admin' }));
  }, token);

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await sleep(1500);
  await clickByText(page, '管理后台'); await sleep(1200);
  await clickByText(page, 'RAG 管理'); await sleep(1200);
  await clickByText(page, '模型设置'); await sleep(2000);

  for (const title of ['嵌入模型', 'LLM 大模型', 'Rerank 重排序']) {
    const ok = await clickTestInBlock(page, title);
    console.log(`点击「${title}」测试连接:`, ok ? 'ok' : '未找到');
    await sleep(5000); // 等结果（llm 真实推理可能稍慢）
  }
  await sleep(500);

  const results = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.ms-test-result')).map(e => e.textContent.trim())
  );
  console.log('测试结果条数:', results.length);
  results.forEach(r => console.log('  -', r));

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(300);
  const out = 'D:/Clow/projects/smart-customer-service/scripts/_shot_model_test.png';
  await page.screenshot({ path: out, fullPage: true });
  console.log('整页截图已保存:', out);

  await page.evaluate(() => {
    const b = document.querySelector('.ms-form-block');
    if (b) b.scrollIntoView({ behavior: 'instant', block: 'start' });
  });
  await sleep(400);
  const out2 = 'D:/Clow/projects/smart-customer-service/scripts/_shot_model_test_block.png';
  await page.screenshot({ path: out2 });
  console.log('首块截图已保存:', out2);

  console.log('RESULT:', results.length === 3 ? 'PASS' : 'WARN');
  await browser.close();
})().catch(e => { console.error('ERROR', e); process.exit(1); });
