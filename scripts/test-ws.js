// 简单测试WebSocket消息格式
const WebSocket = require('ws');

// 简单的session ID生成
function simpleSessionId() {
  return 'test_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

const ws = new WebSocket('ws://localhost:3001/ws');

ws.on('open', () => {
  console.log('WebSocket连接成功');
  
  // 先发送init消息建立会话
  const sessionId = simpleSessionId();
  const initMsg = {
    type: 'init',
    sessionId: sessionId,
    category: null
  };
  console.log('发送init消息:', JSON.stringify(initMsg));
  ws.send(JSON.stringify(initMsg));
  
  // 等待一下再发送测试消息
  setTimeout(() => {
    const testMessage = {
      type: 'message',
      content: '费用报销需要什么材料？',
      timestamp: new Date().toISOString()
    };
    
    console.log('发送消息:', JSON.stringify(testMessage));
    ws.send(JSON.stringify(testMessage));
  }, 1000);
});

ws.on('message', (data) => {
  try {
    const response = JSON.parse(data);
    console.log('收到响应:', JSON.stringify(response, null, 2));
    
    // 如果是typing消息，继续等待
    if (response.type === 'typing') {
      console.log('AI正在输入...');
      return;
    }
    
    // 其他消息，关闭连接
    setTimeout(() => {
      ws.close();
      process.exit(0);
    }, 1000);
  } catch (e) {
    console.log('收到非JSON消息:', data.toString());
  }
});

ws.on('error', (error) => {
  console.error('WebSocket错误:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('超时退出');
  ws.close();
  process.exit(1);
}, 30000);
