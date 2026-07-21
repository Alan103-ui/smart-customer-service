// 用本机 Microsoft Edge 无头截图审计页（平铺视图 + 分组视图）
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const BASE = 'http://localhost:3001';
const OUT = 'D:/Clow/projects/smart-customer-service/scripts';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function clickByText(page, sel, text) {
  const handle = await page.evaluateHandle(
    (s, t) => {
      const els = Array.from(document.querySelectorAll(s));
      return els.find(e => (e.textContent || '').includes(t)) || null;
    }, sel, text
  );
  const el = handle.asElement();
  if (el) { await el.click(); return true; }
  return false;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const log = (m) => console.log(m);

  // 1) 登录
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[placeholder="请输入用户名"]', 'admin');
  await page.type('input[placeholder="请输入密码"]', 'admin123');
  await clickByText(page, 'button', '登录');
  await sleep(1500);
  log('✅ 已提交登录');

  // 2) 进入 /admin（整页重载渲染 AdminDashboard）
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2' });
  await sleep(1200);

  // 3) 打开「日志管理」
  const okLogs = await clickByText(page, 'button', '日志管理');
  log(okLogs ? '✅ 点击 日志管理' : '❌ 未找到 日志管理 按钮');
  await sleep(800);

  // 4) 打开「操作审计」
  const okAudit = await clickByText(page, 'button', '操作审计');
  log(okAudit ? '✅ 点击 操作审计' : '❌ 未找到 操作审计 按钮');
  await sleep(1500); // 等审计列表加载

  // 5) 截图：平铺视图（含日期范围/操作人/操作名筛选栏）
  const f1 = `${OUT}/audit_flat.png`;
  await page.screenshot({ path: f1, fullPage: true });
  log(`📸 平铺视图截图: ${f1}`);

  // 6) 勾选「按操作分组」
  const okGroup = await clickByText(page, 'input', '按操作分组');
  if (!okGroup) {
    // 退化：直接找checkbox点击
    await page.evaluate(() => {
      const cb = document.querySelector('input[type="checkbox"]');
      if (cb) cb.click();
    });
  }
  log('✅ 切换分组视图');
  await sleep(1200);

  // 7) 截图：分组视图（可折叠 + 按计数降序）
  const f2 = `${OUT}/audit_grouped.png`;
  await page.screenshot({ path: f2, fullPage: true });
  log(`📸 分组视图截图: ${f2}`);

  await browser.close();
  const ok = fs.existsSync(f1) && fs.existsSync(f2);
  log(ok ? '\n🎉 两张截图已生成' : '\n⚠️ 截图生成异常');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('脚本异常:', e); process.exit(1); });
