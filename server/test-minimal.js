// 最小测试服务器：排查启动失败
const express = require('express');
const app = express();
const http = require('http');
const WebSocket = require('ws');

console.log('[Test] 1. 创建Express应用...');
console.log('[Test] 2. 创建HTTP服务器...');
const server = http.createServer(app);

console.log('[Test] 3. 创建WebSocket服务器...');
const wss = new WebSocket.Server({ server, path: '/ws' });

console.log('[Test] 4. 注册一个测试路由...');
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

console.log('[Test] 5. 启动服务器（端口3001）...');
server.listen(3001, '0.0.0.0', () => {
  console.log('[Test] ✅ 服务器启动成功！监听端口3001');
  console.log('[Test] 测试：curl http://localhost:3001/api/health');
});

server.on('error', (err) => {
  console.error('[Test] ❌ 服务器启动失败:', err.message);
  process.exit(1);
});

// 5秒后自动退出
setTimeout(() => {
  console.log('[Test] 测试完成，退出');
  process.exit(0);
}, 5000);
