/**
 * 性能测试：响应时间、内存占用
 */

const { understandIntent } = require('./intent-understanding');
const { enhanceQueryWithMemory } = require('./dialogue-memory');
const { rewriteToColloquial } = require('./answer-rewriter');

const TEST_SESSION = 'perf_test_' + Date.now();

/**
 * 性能测试：响应时间
 */
async function testResponseTime() {
  console.log('========== 性能测试：响应时间 ==========\n');
  
  // 1. 测试意图理解模块响应时间
  console.log('[测试1] 意图理解模块响应时间...');
  const intentTimes = [];
  
  for (let i = 0; i < 5; i++) {
    const start = Date.now();
    await understandIntent('如何申请报销');
    const end = Date.now();
    intentTimes.push(end - start);
  }
  
  const avgIntentTime = intentTimes.reduce((a, b) => a + b, 0) / intentTimes.length;
  console.log(`  ✅ 平均响应时间: ${avgIntentTime.toFixed(2)}ms`);
  console.log(`     最短: ${Math.min(...intentTimes)}ms`);
  console.log(`     最长: ${Math.max(...intentTimes)}ms`);
  
  // 2. 测试对话记忆模块响应时间（首次查询，无缓存）
  console.log('\n[测试2] 对话记忆模块响应时间（首次查询，无缓存）...');
  
  // 先存储一些测试数据
  const { storeConversationRound } = require('./dialogue-memory');
  for (let i = 0; i < 5; i++) {
    storeConversationRound(TEST_SESSION, {
      userQuery: `测试查询 ${i}`,
      aiResponse: `测试回答 ${i}`,
      intent: { level1: 'query', level2: 'test' }
    });
  }
  
  const memoryTimes1 = [];
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    await enhanceQueryWithMemory(`测试查询 ${i}`, TEST_SESSION);
    const end = Date.now();
    memoryTimes1.push(end - start);
  }
  
  const avgMemoryTime1 = memoryTimes1.reduce((a, b) => a + b, 0) / memoryTimes1.length;
  console.log(`  ✅ 平均响应时间（首次）: ${avgMemoryTime1.toFixed(2)}ms`);
  console.log(`     注意：首次查询需要计算嵌入向量，耗时较长`);
  
  // 3. 测试对话记忆模块响应时间（二次查询，有缓存）
  console.log('\n[测试3] 对话记忆模块响应时间（二次查询，有缓存）...');
  
  const memoryTimes2 = [];
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    await enhanceQueryWithMemory('如何申请报销', TEST_SESSION);
    const end = Date.now();
    memoryTimes2.push(end - start);
  }
  
  const avgMemoryTime2 = memoryTimes2.reduce((a, b) => a + b, 0) / memoryTimes2.length;
  console.log(`  ✅ 平均响应时间（缓存）: ${avgMemoryTime2.toFixed(2)}ms`);
  console.log(`     提升: ${((avgMemoryTime1 - avgMemoryTime2) / avgMemoryTime1 * 100).toFixed(2)}%`);
  
  // 4. 测试答案改写模块响应时间
  console.log('\n[测试4] 答案改写模块响应时间...');
  const rewriteTimes = [];
  
  for (let i = 0; i < 3; i++) {
    const start = Date.now();
    await rewriteToColloquial('您的报销申请已批准，请在3个工作日内查收。', '我的报销怎么样了');
    const end = Date.now();
    rewriteTimes.push(end - start);
  }
  
  const avgRewriteTime = rewriteTimes.reduce((a, b) => a + b, 0) / rewriteTimes.length;
  console.log(`  ✅ 平均响应时间: ${avgRewriteTime.toFixed(2)}ms`);
  console.log(`     最短: ${Math.min(...rewriteTimes)}ms`);
  console.log(`     最长: ${Math.max(...rewriteTimes)}ms`);
  
  console.log('\n========== 性能测试完成 ==========');
  
  return {
    intent: { avg: avgIntentTime, min: Math.min(...intentTimes), max: Math.max(...intentTimes) },
    memoryFirst: { avg: avgMemoryTime1 },
    memoryCached: { avg: avgMemoryTime2, improvement: ((avgMemoryTime1 - avgMemoryTime2) / avgMemoryTime1 * 100).toFixed(2) },
    rewrite: { avg: avgRewriteTime, min: Math.min(...rewriteTimes), max: Math.max(...rewriteTimes) }
  };
}

/**
 * 性能测试：内存占用
 */
function testMemoryUsage() {
  console.log('\n========== 性能测试：内存占用 ==========\n');
  
  const memUsage = process.memoryUsage();
  
  console.log(`  ✅ 常驻内存（RSS）: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  ✅ 堆内存总量: ${(memUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  ✅ 堆内存使用: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  ✅ 外部内存: ${(memUsage.external / 1024 / 1024).toFixed(2)} MB`);
  
  console.log('\n========== 内存占用测试完成 ==========');
  
  return {
    rss: (memUsage.rss / 1024 / 1024).toFixed(2),
    heapTotal: (memUsage.heapTotal / 1024 / 1024).toFixed(2),
    heapUsed: (memUsage.heapUsed / 1024 / 1024).toFixed(2),
    external: (memUsage.external / 1024 / 1024).toFixed(2)
  };
}

/**
 * 运行性能测试
 */
async function runPerformanceTest() {
  try {
    const timeResults = await testResponseTime();
    const memoryResults = testMemoryUsage();
    
    console.log('\n\n========== 性能测试总结 ==========');
    console.log('\n[响应时间]');
    console.log(`  意图理解: ${timeResults.intent.avg.toFixed(2)}ms (最短: ${timeResults.intent.min}ms, 最长: ${timeResults.intent.max}ms)`);
    console.log(`  对话记忆（首次）: ${timeResults.memoryFirst.avg.toFixed(2)}ms`);
    console.log(`  对话记忆（缓存）: ${timeResults.memoryCached.avg.toFixed(2)}ms (提升: ${timeResults.memoryCached.improvement}%)`);
    console.log(`  答案改写: ${timeResults.rewrite.avg.toFixed(2)}ms (最短: ${timeResults.rewrite.min}ms, 最长: ${timeResults.rewrite.max}ms)`);
    
    console.log('\n[内存占用]');
    console.log(`  常驻内存（RSS）: ${memoryResults.rss} MB`);
    console.log(`  堆内存使用: ${memoryResults.heapUsed} MB / ${memoryResults.heapTotal} MB`);
    console.log(`  外部内存: ${memoryResults.external} MB`);
    
    console.log('\n========== 性能测试完成 ==========');
    
  } catch (err) {
    console.error('❌ 性能测试失败:', err);
    process.exit(1);
  }
}

// 运行测试
runPerformanceTest();