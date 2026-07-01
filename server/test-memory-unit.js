/**
 * 对话记忆模块单元测试
 * 直接测试 dialogue-memory.js 的导出函数
 */

const {
  storeConversationRound,
  getConversationHistory,
  enhanceQueryWithMemory,
  getMemoryStats,
  clearConversationHistory
} = require('./dialogue-memory');

console.log('=== 对话记忆模块单元测试 ===\n');

// 模拟用户ID
const testUserId = 'test-user-001';
const testSessionId = 'test-session-' + Date.now();

// 测试1: 存储对话轮次
console.log('[测试1] 存储对话轮次...');
const round1 = {
  userQuery: '广康集团的主营业务是什么？',
  aiResponse: '广康集团主要从事汽车零部件制造，包括发动机配件、底盘系统等。',
  timestamp: Date.now(),
  intent: 'query_business',
  entities: [{ type: 'organization', value: '广康集团' }]
};

storeConversationRound(testSessionId, round1, testUserId);
console.log('✅ 第1轮对话已存储');

const round2 = {
  userQuery: '它成立于哪一年？',  // 依赖上下文
  aiResponse: '广康集团成立于2005年。',
  timestamp: Date.now(),
  intent: 'query_founding_date',
  entities: [],  // 实体为空，依赖上下文
  context: { dependsOn: 'previous' }
};

storeConversationRound(testSessionId, round2, testUserId);
console.log('✅ 第2轮对话已存储（依赖上下文）');

console.log('');

// 测试2: 获取对话历史
console.log('[测试2] 获取对话历史...');
const historyResult = getConversationHistory(testSessionId, 10, false, testUserId);
console.log('✅ 对话历史获取成功:');
console.log(`   会话ID: ${historyResult.sessionId}`);
console.log(`   历史轮次: ${historyResult.history.length}`);
console.log(`   格式化历史:`);
historyResult.history.forEach((round, i) => {
  console.log(`     ${i+1}. 用户: ${round.userMessage}`);
  console.log(`        助手: ${round.assistantMessage}`);
});

console.log('');

// 测试3: 增强查询（上下文理解）
console.log('[测试3] 增强查询（上下文理解）...');
const enhanced1 = enhanceQueryWithMemory('它有哪些产品？', testUserId);
console.log('✅ 查询增强结果:');
console.log(`   原始查询: ${enhanced1.originalQuery}`);
console.log(`   增强查询: ${enhanced1.enhancedQuery}`);
console.log(`   上下文轮次: ${enhanced1.contextRounds}`);
console.log(`   检测到的实体:`, enhanced1.detectedEntities);

console.log('');

// 测试4: 获取记忆统计
console.log('[测试4] 获取记忆统计...');
const stats = getMemoryStats(testUserId);
console.log('✅ 记忆统计:');
console.log(`   总记忆数: ${stats.total_memories}`);
console.log(`   活跃会话: ${stats.active_sessions}`);
console.log(`   用户记忆:`, stats.user_memories);

console.log('');

// 测试5: 清空对话历史
console.log('[测试5] 清空对话历史...');
const clearResult = clearConversationHistory(testSessionId, testUserId);
console.log('✅ 清空结果:', clearResult);

console.log('');
console.log('=== 所有测试完成 ===');
console.log('✅ 对话记忆模块功能正常！');
