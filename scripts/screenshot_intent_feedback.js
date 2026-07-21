// 截图验证：意图在线标注/纠错闭环 UI（直接注入 token，避免登录 UI 不稳定）
const puppeteer = require('C:/Users/Alan/.workbuddy/binaries/node/workspace/node_modules/puppeteer-core');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = 'http://localhost:3001';
const OUT = 'D:/Clow/projects/smart-customer-service/scripts';

async function getToken() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const j = await r.json();
  return j.token || (j.data && j.data.token);
}

(async () => {
  const token = await getToken();
  if (!token) throw new Error('获取 token 失败');
  console.log('[SHOT] token 长度=', token.length);

  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1400,1000']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });

  // 注入 token
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => {
    localStorage.setItem('cs_token', t);
    localStorage.setItem('cs_user', JSON.stringify({ username: 'admin', name: '管理员', role: 'admin' }));
  }, token);

  // ===== 聊天界面（强制新会话）=====
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 2000));
  await page.waitForSelector('input.input-field-modern', { timeout: 10000 });

  const beforeCount = await page.evaluate(() => document.querySelectorAll('.message-bubble-modern.assistant').length);
  await page.evaluate(() => {
    const inp = document.querySelector('input.input-field-modern');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(inp, '成都明天天气怎么样');
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => /发送/.test(b.textContent || ''));
    if (btn) btn.click();
  });
  // 等待新的助手消息出现并流式结束（轮询 45 秒）
  for (let i = 0; i < 90; i++) {
    await new Promise(r => setTimeout(r, 500));
    const ready = await page.evaluate(() => {
      const bubbles = document.querySelectorAll('.message-bubble-modern.assistant');
      if (!bubbles.length) return false;
      const last = bubbles[bubbles.length - 1];
      const hasIntent = !!last.querySelector('.message-intent-modern');
      const isTyping = !!document.querySelector('.typing-indicator-modern');
      const isStreaming = !!document.querySelector('.stream-cursor-modern');
      return hasIntent && !isTyping && !isStreaming;
    });
    if (ready) break;
  }
  await page.screenshot({ path: `${OUT}/shot_intent_chat.png` });
  console.log('[SHOT] 聊天界面截图完成');

  // ===== 后台意图纠错 Tab =====
  await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 1500));
  // 点「智能意图理解」顶部 Tab（用 clickByText 确保点击到交互元素）
  const clickedIntent = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const el = btns.find(b => /智能意图理解/.test(b.textContent || ''));
    if (el) { el.click(); return true; }
    return false;
  });
  console.log('[SHOT] 点击 智能意图理解:', clickedIntent);
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const el = btns.find(b => /意图纠错/.test(b.textContent || ''));
    if (el) el.click();
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: `${OUT}/shot_intent_correction.png`, fullPage: true });
  console.log('[SHOT] 意图纠错 Tab 截图完成');

  await browser.close();
  console.log('🎉 截图全部完成');
})().catch(e => { console.error('❌ 截图失败:', e.message); process.exit(1); });
