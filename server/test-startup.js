// 测试脚本：排查阶段1改造导致的启动失败
console.log('[Test] 开始测试...');

try {
  console.log('[Test] 1. 加载 auth.js...');
  const auth = require('./auth');
  console.log('[Test]   ✅ auth.js 加载成功');
  
  console.log('[Test] 2. 加载 rag-admin.js...');
  const ragAdmin = require('./rag-admin');
  console.log('[Test]   ✅ rag-admin.js 加载成功');
  
  console.log('[Test] 3. 加载 index.js...');
  // 不实际加载，只检查语法
  const fs = require('fs');
  const code = fs.readFileSync('./index.js', 'utf8');
  try {
    new Function(code);
    console.log('[Test]   ✅ index.js 语法检查通过');
  } catch (e) {
    console.error('[Test]   ❌ index.js 语法错误:', e.message);
  }
  
  console.log('\n[Test] 测试完成');
} catch (e) {
  console.error('[Test] ❌ 加载失败:', e.message);
  console.error(e.stack);
}