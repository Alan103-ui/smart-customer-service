// WS 流式对话端到端测试：验证修复后的意图字段(pi.level1/pi.level2)在真实流式路径正确传递+落库
// 覆盖 index.js 1449/1473/1466 行之前的 bug（intentResult.intent → pi.level1）
const path = require('path');
const fs = require('fs');

function requireWs() {
  try { return require('ws'); }
  catch (e) { return require('D:/Clow/projects/smart-customer-service/server/node_modules/ws'); }
}
const WebSocket = requireWs();

const BASE = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001/ws';
const DB_FILE = path.resolve(__dirname, '../data/conversations.json');
const USED_SESSIONS = [];

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${detail !== undefined ? '→ ' + JSON.stringify(detail) : ''}`); }
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'admin123' })
  });
  const j = await r.json();
  if (!j.token) throw new Error('login failed: ' + JSON.stringify(j));
  return j.token;
}

function wsRound(token, query, sessionId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const msgs = [];
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; ws.close(); reject(new Error('WS timeout, got types: ' + msgs.map(m => m.type).join(','))); }
    }, 90000);
    ws.on('open', () => ws.send(JSON.stringify({ type: 'init', token, sessionId })));
    ws.on('message', (data) => {
      let m; try { m = JSON.parse(data); } catch (e) { return; }
      msgs.push(m);
      if (m.type === 'init') { ws.send(JSON.stringify({ type: 'message', content: query })); return; }
      // 终态：流式结束 或 含内容的 message
      if (m.type === 'stream_end' || (m.type === 'message' && m.content)) {
        done = true; clearTimeout(timer); ws.close();
        resolve({ msgs, final: m, candidates: false, sessionId });
      }
      // 命中 FAQ 候选（无 stream_end）：稍候判定为 candidates
      if (m.type === 'candidates') {
        setTimeout(() => { if (!done) { done = true; clearTimeout(timer); ws.close(); resolve({ msgs, final: null, candidates: true, sessionId }); } }, 1800);
      }
    });
    ws.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}

function cleanup(sessions) {
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const before = (db.conversations.length) + (db.faq_logs.length);
    db.conversations = db.conversations.filter(c => !sessions.includes(c.session_id));
    db.faq_logs = db.faq_logs.filter(l => !sessions.includes(l.session_id));
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    const after = (db.conversations.length) + (db.faq_logs.length);
    console.log(`\n[cleanup] 移除测试会话数据 ${before - after} 条`);
  } catch (e) { console.log('  ⚠️ 清理失败:', e.message); }
}

(async () => {
  const token = await login();
  const QUERIES = [
    '帮我查询成都明天的天气预报并提醒我带伞',
    '我想预约下周三去总公司办理车辆通行证的流程'
  ];
  let tested = false;

  for (const Q of QUERIES) {
    const sessionId = 'ws-test-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    USED_SESSIONS.push(sessionId);
    console.log(`\n[WS] query="${Q}"  session=${sessionId}`);
    let res;
    try { res = await wsRound(token, Q, sessionId); }
    catch (e) { check('WS 连接/对话完成', false, e.message); continue; }
    if (res.candidates) { console.log('  ⚠️ 命中 FAQ 候选分支，换 query 重试'); continue; }
    tested = true;

    const f = res.final;
    console.log('  终态:', JSON.stringify({
      type: f.type, intent: f.intent, intentLevel2: f.intentLevel2,
      confidence: f.confidence, messageId: f.messageId, contentLen: (f.content || '').length
    }));

    check('收到终态消息', !!f, res.msgs.map(m => m.type));
    check('意图 intent 为字符串且非空（pi.level1 正确传递，非 undefined/null）', typeof f.intent === 'string' && f.intent.length > 0, f.intent);
    if (f.type === 'stream_end') {
      check('stream_end.intentLevel2 为字符串且非空（pi.level2）', typeof f.intentLevel2 === 'string' && f.intentLevel2.length > 0, f.intentLevel2);
      check('stream_end.confidence 为数字', typeof f.confidence === 'number', f.confidence);
      check('stream_end.messageId 非空', !!f.messageId, f.messageId);
    }

    // 落库验证
    try {
      const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const conv = db.conversations.find(c => c.session_id === sessionId);
      check('会话已落库 conversations.json', !!conv, sessionId);
      if (conv) {
        console.log('  conv.intent =', JSON.stringify(conv.intent));
        check('落库 intent 与返回一致（saveMessage 用 pi.level1）', conv.intent === f.intent, { conv: conv.intent, final: f.intent });
      }
      const lastLog = db.faq_logs[db.faq_logs.length - 1];
      if (lastLog && lastLog.session_id === sessionId) {
        console.log('  faq_logs.intent =', JSON.stringify(lastLog.intent), 'intentLevel2 =', JSON.stringify(lastLog.intentLevel2));
        check('faq_logs 落库 intent 非空（pi.level1）', typeof lastLog.intent === 'string' && lastLog.intent.length > 0, lastLog.intent);
        check('faq_logs 落库 intentLevel2 非空（pi.level2）', typeof lastLog.intentLevel2 === 'string' && lastLog.intentLevel2.length > 0, lastLog.intentLevel2);
      } else {
        console.log('  (该分支未写 faq_logs，跳过 faq_logs 断言)');
      }
    } catch (e) { check('读取 conversations.json', false, e.message); }
    break;
  }

  if (!tested) check('至少完成一次 WS 流式对话断言', false, '所有 query 均命中 FAQ 候选');

  cleanup(USED_SESSIONS);
  console.log(`\n==== WS 流式意图测试：通过 ${pass} / 失败 ${fail} ====`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('异常:', e); cleanup(USED_SESSIONS); process.exit(2); });
