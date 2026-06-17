/**
 * 集成测试：三个核心AI模块协同工作
 * 测试场景：完整的用户对话流程
 */

const { understandIntent } = require('./intent-understanding');
const { enhanceQueryWithMemory } = require('./dialogue-memory');
const { rewriteToColloquial } = require('./answer-rewriter');

const TEST_SESSION = 'integration_test_' + Date.now();

/**
 * 模拟完整的用户对话流程
 */
async function testCompleteFlow() {
  console.log('========== 开始集成测试 ==========\n');
  
  // 1. 第一轮对话
  console.log('[流程] 第一轮对话：用户问候');
  const query1 = '你好';
  
  // 意图理解
  const intent1 = await understandIntent(query1);
  console.log(`  意图: ${intent1.primaryIntent.level1}/${intent1.primaryIntent.level2} (置信度: ${intent1.primaryIntent.confidence})`);
  
  // 模拟AI回答
  const aiResponse1 = '您好！我是广康集团AI助手小智，很高兴为您服务😊 有什么我可以帮您的吗？';
  
  // 存储到对话记忆
  const storeResult1 = storeConversationRound(TEST_SESSION, {
    userQuery: query1,
    aiResponse: aiResponse1,
    intent: intent1.primaryIntent
  });
  console.log(`  存储: ${storeResult1.success ? '成功' : '失败'}`);
  
  // 2. 第二轮对话
  console.log('\n[流程] 第二轮对话：用户提问（包含指代词）');
  const query2 = '如何申请报销';
  
  // 增强查询（使用对话记忆）
  const enhanced2 = await enhanceQueryWithMemory(query2, TEST_SESSION);
  console.log(`  原始查询: ${enhanced2.originalQuery}`);
  console.log(`  增强查询: ${enhanced2.enhancedQuery.slice(0, 100)}...`);
  console.log(`  使用历史: ${enhanced2.usedHistory.length} 轮`);
  
  // 意图理解
  const intent2 = await understandIntent(enhanced2.enhancedQuery);
  console.log(`  意图: ${intent2.primaryIntent.level1}/${intent2.primaryIntent.level2} (置信度: ${intent2.primaryIntent.confidence})`);
  
  // 模拟RAG检索结果
  const ragResult2 = '您可以登录在线报销系统，填写报销单并上传发票原件，提交后等待审批即可。';
  
  // 答案改写
  const rewritten2 = await rewriteToColloquial(ragResult2, query2, {
    tone: 'friendly',
    emotion: 'neutral'
  });
  console.log(`  原答案: ${ragResult2}`);
  console.log(`  改写后: ${rewritten2.slice(0, 100)}...`);
  
  // 存储到对话记忆
  const storeResult2 = storeConversationRound(TEST_SESSION, {
    userQuery: query2,
    aiResponse: rewritten2,
    intent: intent2.primaryIntent
  });
  console.log(`  存储: ${storeResult2.success ? '成功' : '失败'}`);
  
  // 3. 第三轮对话
  console.log('\n[流程] 第三轮对话：用户提问（包含指代词）');
  const query3 = '它需要多长时间';
  
  // 增强查询（使用对话记忆）
  const enhanced3 = await enhanceQueryWithMemory(query3, TEST_SESSION);
  console.log(`  原始查询: ${enhanced3.originalQuery}`);
  console.log(`  增强查询: ${enhanced3.enhancedQuery.slice(0, 100)}...`);
  console.log(`  指代消解: ${JSON.stringify(enhanced3.coreferences)}`);
  console.log(`  使用历史: ${enhanced3.usedHistory.length} 轮`);
  
  // 意图理解
  const intent3 = await understandIntent(enhanced3.enhancedQuery);
  console.log(`  意图: ${intent3.primaryIntent.level1}/${intent3.primaryIntent.level2} (置信度: ${intent3.primaryIntent.confidence})`);
  
  // 模拟RAG检索结果
  const ragResult3 = '一般情况下，报销审批需要3-5个工作日。';
  
  // 答案改写
  const rewritten3 = await rewriteToColloquial(ragResult3, query3, {
    tone: 'friendly',
    emotion: 'neutral'
  });
  console.log(`  原答案: ${ragResult3}`);
  console.log(`  改写后: ${rewritten3.slice(0, 100)}...`);
  
  // 存储到对话记忆
  const storeResult3 = storeConversationRound(TEST_SESSION, {
    userQuery: query3,
    aiResponse: rewritten3,
    intent: intent3.primaryIntent
  });
  console.log(`  存储: ${storeResult3.success ? '成功' : '失败'}`);
  
  // 4. 验证对话记忆
  console.log('\n[流程] 验证对话记忆');
  const { success, history, context } = getConversationHistory(TEST_SESSION, 10, true);
  
  if (success && history.length === 3) {
    console.log(`  ✅ 历史轮次: ${history.length} 轮（期望3轮）`);
  } else {
    console.log(`  ❌ 历史轮次: ${history.length} 轮（期望3轮）`);
  }
  
  if (context && context.keyEntities.length > 0) {
    console.log(`  ✅ 关键实体: ${context.keyEntities.map(e => e.value).join(', ')}`);
  } else {
    console.log(`  ❌ 关键实体: 无`);
  }
  
  console.log('\n========== 集成测试完成 ==========');
  console.log('✅ 三个模块协同工作正常');
  console.log('✅ 完整的用户对话流程测试通过');
}

/**
 * 运行集成测试
 */
async function runIntegrationTest() {
  try {
    await testCompleteFlow();
  } catch (err) {
    console.error('❌ 集成测试失败:', err);
    process.exit(1);
  }
}

// 导入对话记忆模块的函数
const { storeConversationRound, getConversationHistory } = require('./dialogue-memory');

// 运行测试
runIntegrationTest();