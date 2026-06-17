// 简化测试：只测试高置信度（0.6-0.8）的LLM改写功能
const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3001/ws';

async function testHighConfidence() {
  console.log('🚀 开始测试高置信度LLM改写功能...\n');
  
  const ws = new WebSocket(WS_URL);
  
  return new Promise((resolve) => {
    let sessionId = null;
    let step = 0;
    
    ws.on('open', () => {
      console.log('✅ WebSocket连接成功');
      
      // 发送init消息
      ws.send(JSON.stringify({
        type: 'init',
        userId: 'test_user_' + Date.now(),
        userName: '测试用户'
      }));
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      
      if (msg.type === 'init') {
        sessionId = msg.sessionId;
        console.log(`✅ 会话初始化成功: ${sessionId}`);
        
        // 发送高置信度消息（应该触发LLM改写）
        // 注意：需要找到一个置信度在0.6-0.8之间的问题
        // 如果"城市分类标准"的置信度是0.98（超高），那会直接返回，不触发LLM改写
        // 所以需要找一个置信度适中的消息
        const testMessage = '广康集团有哪些服务';  // 可能置信度适中
        console.log(`\n📤 发送消息: "${testMessage}"`);
        console.log(`   （期望：置信度0.6-0.8，触发LLM改写）\n`);
        
        ws.send(JSON.stringify({
          type: 'message',
          content: testMessage
        }));
      }
      
      if (msg.type === 'typing') {
        console.log(`  [${msg.status ? '开始' : '结束'}输入提示]  ${msg.status ? '（LLM正在改写答案...）' : ''}`);
      }
      
      if (msg.type === 'message') {
        console.log(`\n✅ 收到AI回复:`);
        console.log(`   内容: ${msg.content.substring(0, 150)}...`);
        console.log(`   置信度: ${msg.confidence || 'N/A'}`);
        console.log(`   是否改写: ${msg.rewritten || false}`);
        console.log(`   匹配问题: ${msg.matchedQuestion || 'N/A'}`);
        
        if (msg.rewritten) {
          console.log(`\n🎉 测试成功！LLM改写已生效！`);
        } else {
          console.log(`\n⚠️ 未触发LLM改写（可能置信度≥0.8，直接返回）`);
          console.log(`   建议：尝试其他消息，或者降低超高置信度阈值（从0.8降到0.7）`);
        }
        
        ws.close();
        resolve(msg.rewritten);
      }
    });
    
    ws.on('error', (err) => {
      console.error(`❌ WebSocket错误: ${err.message}`);
      resolve(false);
    });
    
    ws.on('close', () => {
      console.log(`\n✅ WebSocket连接关闭`);
    });
    
    // 超时处理（60秒）
    setTimeout(() => {
      console.log(`\n⚠️ 测试超时（60秒）`);
      console.log(`   可能原因：`);
      console.log(`   1. LLM改写请求超时（Ollama响应慢）`);
      console.log(`   2. 代码逻辑错误（Promise没有正确resolve）`);
      console.log(`   3. 消息置信度<0.6，走了候选列表逻辑（但测试脚本没有实现候选列表选择）`);
      ws.close();
      resolve(false);
    }, 60000);
  });
}

testHighConfidence().then((rewritten) => {
  console.log(`\n🎉 测试完成！LLM改写: ${rewritten ? '已生效' : '未生效'}`);
  process.exit(rewritten ? 0 : 1);
}).catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
