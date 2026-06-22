const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3001/ws';
const TESTS = [
  { name: '短查询（触发查询改写）', message: '报销' },
  { name: '标准查询', message: '如何申请费用报销' },
  { name: 'RAG检索查询', message: '付款审批流程是什么' },
];

function testWS(test) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    const sessionId = 'test-' + Date.now();
    let step = 0;
    let timer = null;
    const t0 = Date.now();

    function cleanup() {
      clearTimeout(timer);
      try { ws.close(); } catch(e) {}
    }

    timer = setTimeout(() => {
      console.log(`  ❌ 超时`);
      cleanup();
      resolve({ ok: false, error: 'timeout' });
    }, 90000);

    ws.on('open', () => {
      console.log(`\n[${test.name}] 连接成功，发送 init...`);
      ws.send(JSON.stringify({ type: 'init', sessionId }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      
      if (msg.type === 'init' && step === 0) {
        step = 1;
        console.log(`  init 成功，sessionId=${msg.sessionId}`);
        console.log(`  发送消息："${test.message}"`);
        ws.send(JSON.stringify({ type: 'message', content: test.message }));
        return;
      }
      
      if (msg.type === 'intent') {
        console.log(`  ← 意图识别：${msg.intent || 'N/A'}`);
        return;
      }
      
      if (msg.type === 'candidates') {
        const list = msg.candidates || [];
        console.log(`  ← 候选FAQ：${list.length} 条，自动选择第1条`);
        if (list.length > 0) {
          ws.send(JSON.stringify({ 
            type: 'select_candidate', 
            candidateId: list[0].id 
          }));
        }
        return;
      }
      
      if (msg.type === 'typing') {
        return;
      }
      
      // 关键修复：区分用户消息回显 和 AI 回复
      if (msg.type === 'message') {
        // role='user' 是用户消息回显，不是最终回复
        if (msg.role === 'user') {
          console.log(`  ← 用户消息回显确认`);
          return;
        }
        // 没有 role='user' 且有 content：这就是 AI 回复！
        if (msg.content) {
          const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
          clearTimeout(timer);
          console.log(`  ✅ 收到回复（耗时 ${elapsed}s）：`);
          console.log(`    回复：${(msg.content || '').substring(0, 150)}`);
          console.log(`    意图：${msg.intent || 'N/A'}`);
          cleanup();
          resolve({ ok: true, elapsed, reply: msg.content, intent: msg.intent });
          return;
        }
      }
      
      console.log(`  收到消息：`, msg.type, JSON.stringify(msg).substring(0, 80));
    });

    ws.on('error', (err) => {
      clearTimeout(timer);
      console.log(`  ❌ 错误：${err.message}`);
      cleanup();
      resolve({ ok: false, error: err.message });
    });

    ws.on('close', () => {
      if (step < 2) {
        clearTimeout(timer);
        resolve({ ok: false, error: '连接关闭' });
      }
    });
  });
}

async function run() {
  console.log('=== RAG 优化测试（含 Rerank）===');
  const results = [];
  for (const test of TESTS) {
    const r = await testWS(test);
    results.push({ ...test, ...r });
    await new Promise(r => setTimeout(r, 2000));
  }

  console.log('\n=== 测试总结 ===');
  let ok = 0;
  results.forEach((r, i) => {
    console.log(`[${i+1}] ${r.name}：${r.ok ? '✅' : '❌'}  ${r.elapsed ? r.elapsed+'s' : r.error}`);
    if (r.ok) ok++;
  });
  console.log(`\n通过：${ok}/${results.length}`);
  console.log('\n📋 请查看后端控制台，确认 Rerank 日志：');
  console.log('  [Rerank] 查询: "...", 文档数: N, 耗时: Xs');
  console.log('  [QueryRewrite] 改写成功: "..." → "..."');
}

run().catch(e => console.error('Fatal:', e));
