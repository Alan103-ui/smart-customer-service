/**
 * 测试4个营业执照问题的RAG匹配效果
 * 验证：修改detectIntent()后，不同问题应返回不同答案
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

function testQuestion(ws) {
  if (currentIndex >= questions.length) {
    console.log('\n📋 测试总结');
    console.log('='.repeat(60));
    results.forEach((r, i) => {
      console.log(`\n测试${i+1}：${r.question}`);
      console.log(`  意图：${r.intent}, 置信度：${r.confidence}`);
      console.log(`  回复（前100字）：${r.reply.slice(0, 100)}...`);
    });
    
    // 检查是否所有回复都不同
    const uniqueReplies = new Set(results.map(r => r.reply.slice(0, 50)));
    console.log('\n' + '='.repeat(60));
    if (uniqueReplies.size === results.length) {
      console.log('✅ 测试通过！4个问题返回了不同的答案');
    } else {
      console.log('❌ 测试失败！部分问题返回了相同的答案');
    }
    
    ws.close();
    process.exit(0);
    return;
  }
  
  const question = questions[currentIndex];
  console.log(`\n[测试${currentIndex + 1}/4] 发送问题："${question}"`);
  ws.send(JSON.stringify({ type: 'message', content: question }));
}

function runTest() {
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
      testQuestion(ws);
    }
    
    if (msg.type === 'message') {
      console.log(`✅ 收到回复（置信度：${msg.confidence}）`);
      console.log(`   回复：${msg.content.slice(0, 80)}...`);
      
      results.push({
        question: questions[currentIndex],
        intent: msg.intent || 'unknown',
        confidence: msg.confidence,
        reply: msg.content
      });
      
      currentIndex++;
      setTimeout(() => testQuestion(ws), 1000); // 等待1秒再发下一个问题
    }
  });
  
  ws.on('error', (err) => {
    console.error('❌ WebSocket错误：', err.message);
    process.exit(1);
  });
  
  setTimeout(() => {
    console.error('❌ 测试超时（30秒）');
    ws.close();
    process.exit(1);
  }, 30000);
}

console.log('📊 测试4个营业执照问题的RAG匹配效果');
console.log('='.repeat(60));
console.log('');
runTest();
