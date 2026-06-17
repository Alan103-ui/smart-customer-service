/**
 * 测试优化后的对话记忆模块
 * 测试内容：
 * 1. 关键词提取（extractKeywords）
 * 2. 相关历史选择（selectRelevantHistory）
 * 3. 查询增强（enhanceQueryWithMemory）
 */

const {
  storeConversationRound,
  getConversationHistory,
  enhanceQueryWithMemory,
  clearConversationHistory,
  getMemoryStats,
  buildContextFromHistory
} = require('./dialogue-memory');

// ============ 测试数据 ============
const TEST_SESSION = 'test_session_' + Date.now();

const testRounds = [
  {
    userQuery: '如何申请报销',
    aiResponse: '您可以通过在线报销系统提交报销申请，具体步骤是...',
    intent: { primaryIntent: { level1: 'process', level2: 'apply' } },
    entities: [{ type: 'process', value: '报销' }]
  },
  {
    userQuery: '报销需要哪些材料',
    aiResponse: '报销需要以下材料：1. 发票原件 2. 报销单 3. 相关审批文件',
    intent: { primaryIntent: { level1: 'query', level2: 'policy' } },
    entities: [{ type: 'process', value: '报销' }, { type: 'document', value: '材料' }]
  },
  {
    userQuery: '审批需要多长时间',
    aiResponse: '一般情况下，审批需要3-5个工作日',
    intent: { primaryIntent: { level1: 'query', level2: 'policy' } },
    entities: [{ type: 'process', value: '审批' }]
  },
  {
    userQuery: '它支持哪些银行',
    aiResponse: '在线报销系统支持以下银行：中国工商银行、中国建设银行...',
    intent: { primaryIntent: { level1: 'query', level2: 'policy' } },
    entities: [{ type: 'system', value: '在线报销系统' }]
  }
];

// ============ 测试用例 ============

async function runTests() {
  console.log('========== 开始测试对话记忆模块 ==========\n');
  
  // 1. 清除测试会话（确保干净环境）
  console.log('[1] 清除测试会话...');
  const clearResult = clearConversationHistory(TEST_SESSION);
  console.log(`  清除结果: ${clearResult.message}`);
  
  // 2. 存储测试对话轮次
  console.log('\n[2] 存储测试对话轮次...');
  for (const round of testRounds) {
    const result = storeConversationRound(TEST_SESSION, round);
    console.log(`  存储轮次 ${result.roundId}: ${result.success ? '成功' : '失败'}`);
  }
  
  // 3. 测试查询增强（包含指代词）
  console.log('\n[3] 测试查询增强（包含指代词"它"）...');
  const enhanced1 = await enhanceQueryWithMemory('它需要多长时间', TEST_SESSION);
  
  console.log(`  ✅ 原始查询: ${enhanced1.originalQuery}`);
  console.log(`  ✅ 增强查询:\n${enhanced1.enhancedQuery}`);
  console.log(`  ✅ 使用历史轮次: ${enhanced1.usedHistory.length} 轮`);
  console.log(`  ✅ 指代消解映射:`, enhanced1.coreferences);
  
  // 4. 测试查询增强（无指代词，但有相关关键词）
  console.log('\n[4] 测试查询增强（无指代词，有相关关键词）...');
  const enhanced2 = await enhanceQueryWithMemory('报销审批需要多久', TEST_SESSION);
  
  console.log(`  ✅ 原始查询: ${enhanced2.originalQuery}`);
  console.log(`  ✅ 增强查询:\n${enhanced2.enhancedQuery}`);
  console.log(`  ✅ 使用历史轮次: ${enhanced2.usedHistory.length} 轮`);
  
  // 5. 测试查询增强（完全不相关的查询）
  console.log('\n[5] 测试查询增强（完全不相关的查询）...');
  const enhanced3 = await enhanceQueryWithMemory('今天天气怎么样', TEST_SESSION);
  
  console.log(`  ✅ 原始查询: ${enhanced3.originalQuery}`);
  console.log(`  ✅ 增强查询: ${enhanced3.enhancedQuery}`);
  console.log(`  ✅ 使用历史轮次: ${enhanced3.usedHistory.length} 轮`);
  
  // 6. 获取对话历史（包含上下文信息）
  console.log('\n[6] 获取对话历史（包含上下文信息）...');
  const historyResult = getConversationHistory(TEST_SESSION, 10, true);
  
  if (historyResult.success && historyResult.context) {
    console.log(`  ✅ 关键实体: ${historyResult.context.keyEntities.map(e => e.value).join(', ')}`);
    console.log(`  ✅ 话题链长度: ${historyResult.context.topicChain.length}`);
    console.log(`  ✅ 指代消解映射:`, historyResult.context.coreferences);
  }
  
  // 7. 测试API端点（如果服务器运行在3001端口）
  console.log('\n[7] 测试API端点...');
  await testAPIEndpoint();
  
  console.log('\n========== 测试完成 ==========');
}

/**
 * 测试API端点
 */
async function testAPIEndpoint() {
  return new Promise((resolve) => {
    const http = require('http');
    const testQuery = JSON.stringify({
      query: '报销需要哪些材料',
      sessionId: TEST_SESSION
    });
    
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/chat/enhance',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(testQuery)
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          console.log(`  ✅ API调用成功`);
          console.log(`     原始查询: ${result.original}`);
          console.log(`     增强查询: ${result.enhanced.enhancedQuery.slice(0, 100)}...`);
        } catch (e) {
          console.log(`  ⚠️ API响应解析失败: ${e.message}`);
        }
        resolve();
      });
    });
    
    req.on('error', (err) => {
      console.log(`  ⚠️ API测试失败（服务器可能未启动）: ${err.message}`);
      resolve();
    });
    
    req.write(testQuery);
    req.end();
  });
}

// ============ 运行测试 ============
runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
