// 流式输出 e2e：登录 → WS init → 发消息（走 LLM 生成路径）→ 校验 stream 序列
const http = require('http');

const BASE = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001/ws';

function req(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const data = opts.body ? JSON.stringify(opts.body) : null;
    const r = http.request(url, {
      method: opts.method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {}),
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: buf ? JSON.parse(buf) : null }); }
        catch (e) { resolve({ status: res.statusCode, data: buf }); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  // 1) 登录
  const login = await req('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  if (!login.data || !login.data.token) { console.log('登录失败', login); process.exit(1); }
  const token = login.data.token;
  console.log('[登录] OK, token 长度=', token.length);

  // 2) 连接 WS（使用 Node 全局 WebSocket，事件用 addEventListener）
  const WebSocket = global.WebSocket;
  const ws = new WebSocket(WS_URL);
  const seq = [];
  let sessionId = null;
  let streamChunks = [];
  let streamEnd = null;
  let typingTrueSeen = false, typingFalseSeen = false;
  let resolved = false;
  const finish = (code) => { try { ws.close(); } catch (e) {} process.exit(code); };

  ws.addEventListener('open', () => {
    console.log('[WS] open');
    ws.send(JSON.stringify({ type: 'init', sessionId: 'e2e_stream_' + Date.now(), token }));
  });

  ws.addEventListener('message', (ev) => {
    const raw = ev.data;
    let msg; try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    seq.push(msg.type);

    if (msg.type === 'init') {
      sessionId = msg.sessionId;
      console.log('[WS] init, sessionId=', sessionId);
      // 发一条明显不在 FAQ 内、会走 LLM 生成的问题
      setTimeout(() => {
        ws.send(JSON.stringify({ type: 'message', content: '请用一句话告诉我，人工智能对未来客服行业有什么影响？' }));
        console.log('[WS] 已发送用户问题');
      }, 300);
      return;
    }
    if (msg.type === 'typing') { if (msg.status) typingTrueSeen = true; else typingFalseSeen = true; }
    if (msg.type === 'stream') { streamChunks.push(msg.content); }
    if (msg.type === 'stream_end') {
      streamEnd = msg;
      console.log('[WS] stream_end, 内容长度=', (msg.content || '').length);
      if (!resolved) { resolved = true; evaluate(); }
    }
    if (msg.type === 'message' && !streamEnd) {
      // 非流式兜底（如转人工），记录但不算失败
      console.log('[WS] 收到非流式 message（可能走了转人工分支）:', (msg.content || '').slice(0, 40));
    }
  });

  ws.addEventListener('error', (e) => { console.log('[WS] error', e.message || e); finish(2); });

  function evaluate() {
    const concatenated = streamChunks.join('');
    const ok =
      streamChunks.length > 0 &&
      streamEnd &&
      (streamEnd.content || '').length > 0 &&
      concatenated === streamEnd.content &&
      typingTrueSeen;
    console.log('--- 校验 ---');
    console.log('stream 增量条数 =', streamChunks.length);
    console.log('增量拼接 === stream_end 内容 ?', concatenated === (streamEnd.content || ''));
    console.log('首增量预览 =', JSON.stringify(streamChunks[0]));
    console.log('末增量预览 =', JSON.stringify(streamChunks[streamChunks.length - 1]));
    console.log('typing:true 已见 =', typingTrueSeen, ', typing:false 已见 =', typingFalseSeen);
    console.log('最终内容预览 =', (streamEnd.content || '').slice(0, 60));
    console.log(ok ? '\n✅ 流式输出 e2e 通过' : '\n❌ 流式输出 e2e 失败');
    finish(ok ? 0 : 1);
  }

  // 兜底超时
  setTimeout(() => {
    if (!resolved) {
      console.log('[超时] 未收到 stream_end。已收消息序列:', seq.join(','));
      console.log('stream 增量条数=', streamChunks.length, 'stream_end=', !!streamEnd);
      finish(streamChunks.length > 0 ? 0 : 3);
    }
  }, 60000);
})();
