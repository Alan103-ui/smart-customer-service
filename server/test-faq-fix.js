/**
 * 正确测试4个营业执照问题的RAG匹配
 * 正确处理 candidates 消息，选择后获取回复
 */

const WebSocket = require('ws');

const questions = [
  '营业执照怎么办理',
  '办理营业执照需要什么材料',
  '营业执照办理需要多长时间',
  '营业执照年检怎么办理'
];

let currentIndex = 0;
let sessionId = null;
const results = [];

function sendNextQuestion(ws) {
  if (currentIndex >= questions.length) {
    console.log('\n===== 测试总结 =====');
    results.forEach((r, i) => {
      console.log(`\n测试${i+1}："${r.question}"`);
      console.log(`  置信度：${r.confidence}`);
      console.log(`  回复前60字：${r.reply.slice(0, 60)}...`);
    });

    // 检查答案是否不同
    const unique = new Set(results.map(r => r.reply.slice(0, 30)));
    console.log('\n===== 结果 =====');
    if (unique.size === results.length) {
      console.log('✅ 测试通过！4个问题返回了不同的答案');
    } else {
      console.log('❌ 测试失败！部分问题返回了相同的答案');
    }
    ws.close();
    process.exit(0);
    return;
  }

  const q = questions[currentIndex];
  console.log(`\n[测试${currentIndex + 1}/4] 发送："${q}"`);
  ws.send(JSON.stringify({ type: 'message', content: q }));
}

const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  console.log('✅ WebSocket连接成功');
  ws.send(JSON.stringify({ type: 'init', sessionId: 'test_' + Date.now() }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);

  if (msg.type === 'init') {
    sessionId = msg.sessionId;
    console.log('✅ 会话初始化成功');
    sendNextQuestion(ws);
    return;
  }

  if (msg.type === 'candidates') {
    console.log(`✅ 收到候选列表，共${msg.candidates.length}个`);
    msg.candidates.forEach((c, i) => {
      console.log(`  候选${i+1}：[${c.confidence}] ${c.question.slice(0, 30)}...`);
    });
    // 选择第一个候选
    const chosen = msg.candidates[0];
    console.log(`  → 选择候选1：${chosen.question.slice(0, 30)}...`);
    ws.send(JSON.stringify({ type: 'candidate_select', candidateId: chosen.id }));
    return;
  }

  if (msg.type === 'message') {
    console.log(`✅ 收到回复（置信度：${msg.confidence}）`);
    results.push({
      question: questions[currentIndex],
      confidence: msg.confidence,
      reply: msg.content
    });
    currentIndex++;
    setTimeout(() => sendNextQuestion(ws), 1000);
    return;
  }
});

ws.on('error', (err) => {
  console.error('❌ WebSocket错误：', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('❌ 测试超时');
  ws.close();
  process.exit(1);
}, 60000);
