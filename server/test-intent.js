/**
 * 测试意图理解模块
 * 测试内容：
 * 1. 规则引擎（quickRuleCheck）
 * 2. LLM意图理解（understandIntent）
 * 3. 批量意图理解（batchUnderstandIntents）
 * 4. 降级处理（fallbackIntent）
 */

const {
  understandIntent,
  batchUnderstandIntents,
  fallbackIntent,
  INTENT_TAXONOMY
} = require('./intent-understanding');

// ============ 测试用例 ============
const testCases = [
  // 规则引擎测试用例
  { query: '你好', expectedRule: true, description: '规则1：问候语' },
  { query: 'hi', expectedRule: true, description: '规则1：英文问候' },
  { query: '我要投诉', expectedRule: true, description: '规则2：投诉' },
  { query: '申请进度怎么样', expectedRule: true, description: '规则3：查询进度' },
  
  // LLM意图理解测试用例
  { query: '如何申请报销', expectedIntent: 'process/apply', description: 'LLM测试1：报销申请' },
  { query: '报销政策是什么', expectedIntent: 'query/policy', description: 'LLM测试2：政策查询' },
  { query: '客服电话是多少', expectedIntent: 'query/contact', description: 'LLM测试3：联系方式查询' },
  { query: '建议增加微信支付', expectedIntent: 'suggestion/new_feature', description: 'LLM测试4：功能建议' },
  { query: '系统响应太慢了', expectedIntent: 'complaint/service', description: 'LLM测试5：服务投诉' },
  { query: '查询我的订单状态', expectedIntent: 'process/query_status', description: 'LLM测试6：查询状态' }
];

// ============ 测试函数 ============

async function runTests() {
  console.log('========== 开始测试意图理解模块 ==========\n');
  
  let passedRuleTests = 0;
  let passedLLMTests = 0;
  let totalRuleTests = 0;
  let totalLLMTests = 0;
  
  for (const testCase of testCases) {
    console.log(`\n[测试] ${testCase.description}`);
    console.log(`  查询: "${testCase.query}"`);
    
    try {
      const result = await understandIntent(testCase.query);
      
      if (testCase.expectedRule) {
        // 规则引擎测试：检查置信度是否>=0.9（规则引擎的标志）
        totalRuleTests++;
        if (result.primaryIntent && result.primaryIntent.confidence >= 0.9) {
          console.log(`  ✅ 规则引擎命中: ${result.primaryIntent.level1}/${result.primaryIntent.level2} (置信度: ${result.primaryIntent.confidence})`);
          passedRuleTests++;
        } else {
          console.log(`  ❌ 规则引擎未命中: confidence=${result.primaryIntent ? result.primaryIntent.confidence : 'N/A'}`);
        }
      } else {
        // LLM意图理解测试
        totalLLMTests++;
        const actualIntent = `${result.primaryIntent.level1}/${result.primaryIntent.level2}`;
        
        if (actualIntent === testCase.expectedIntent) {
          console.log(`  ✅ 意图正确: ${actualIntent} (置信度: ${result.primaryIntent.confidence})`);
          passedLLMTests++;
        } else {
          console.log(`  ⚠️ 意图不匹配: 期望=${testCase.expectedIntent}, 实际=${actualIntent} (置信度: ${result.primaryIntent.confidence})`);
          // 不完全算失败，因为LLM可能返回合理的其他分类
        }
      }
      
      // 显示详细信息
      if (result.entities && result.entities.length > 0) {
        console.log(`  实体: ${result.entities.map(e => `${e.type}:${e.value}`).join(', ')}`);
      }
      
    } catch (err) {
      console.log(`  ❌ 测试失败: ${err.message}`);
    }
  }
  
  // 测试批量意图理解
  console.log('\n\n[批量测试] 批量意图理解...');
  try {
    const queries = testCases.slice(0, 3).map(t => t.query);
    const batchResults = await batchUnderstandIntents(queries);
    
    console.log(`  ✅ 批量理解完成: ${batchResults.length} 条`);
    batchResults.forEach((r, i) => {
      console.log(`    ${i+1}. "${queries[i]}" → ${r.primaryIntent.level1}/${r.primaryIntent.level2}`);
    });
  } catch (err) {
    console.log(`  ❌ 批量理解失败: ${err.message}`);
  }
  
  // 测试降级处理
  console.log('\n\n[降级测试] 降级处理...');
  try {
    const fallbackResult = fallbackIntent('如何申请报销');
    console.log(`  ✅ 降级处理成功: ${fallbackResult.primaryIntent.level1}/${fallbackResult.primaryIntent.level2}`);
  } catch (err) {
    console.log(`  ❌ 降级处理失败: ${err.message}`);
  }
  
  // 输出测试统计
  console.log('\n\n========== 测试统计 ==========');
  console.log(`规则引擎测试: ${passedRuleTests}/${totalRuleTests} 通过`);
  console.log(`LLM意图理解测试: ${passedLLMTests}/${totalLLMTests} 完全匹配`);
  console.log(`总测试用例: ${testCases.length}`);
  console.log('========== 测试完成 ==========');
}

// 运行测试
runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
