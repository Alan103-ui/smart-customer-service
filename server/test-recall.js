/**
 * RAG 召回率测试脚本
 * 测试优化后的召回率（目标：85%+）
 */

const { searchByFAQCacheAsync } = require('./vector-store');
const fs = require('fs');
const path = require('path');

// 测试查询集（覆盖不同场景）
const TEST_QUERIES = [
  // 原始问题（应该100%召回）
  { query: '财务管理原则是什么？', expectedId: 'faq_001', category: '原始问题' },
  { query: '费用报销的会计确认要求是什么？', expectedId: 'faq_002', category: '原始问题' },
  { query: '财务人员审核单据的职责是什么？', expectedId: 'faq_003', category: '原始问题' },
  
  // 同义改写（测试语义匹配）
  { query: '财务管理的原则有哪些？', expectedId: 'faq_001', category: '同义改写' },
  { query: '报销费用时会计怎么确认？', expectedId: 'faq_002', category: '同义改写' },
  { query: '财务审核单据有哪些职责？', expectedId: 'faq_003', category: '同义改写' },
  
  // 关键词匹配（测试BM25）
  { query: '预算管理', expectedId: 'faq_001', category: '关键词匹配' },
  { query: '报销时间限制', expectedId: 'faq_002', category: '关键词匹配' },
  { query: '预算外支出', expectedId: 'faq_003', category: '关键词匹配' },
  
  // 口语化表达（测试意图理解+检索）
  { query: '怎么报销费用？', expectedId: 'faq_002', category: '口语化表达' },
  { query: '财务要审核什么？', expectedId: 'faq_003', category: '口语化表达' },
  { query: '月结怎么弄？', expectedId: 'faq_004', category: '口语化表达' },
  
  // 混合查询（测试混合检索）
  { query: '备用金能借多少？怎么还？', expectedId: 'faq_005', category: '混合查询' },
  { query: '财务原则和管理要求', expectedId: 'faq_001', category: '混合查询' },
];

async function runTest() {
  console.log('========================================');
  console.log('RAG 召回率测试开始');
  console.log('========================================\n');
  
  let totalTests = TEST_QUERIES.length;
  let recalled = 0;
  let categoryStats = {};
  
  for (const test of TEST_QUERIES) {
    const category = test.category;
    if (!categoryStats[category]) {
      categoryStats[category] = { total: 0, recalled: 0 };
    }
    categoryStats[category].total++;
    
    try {
      console.log(`[测试] 查询: "${test.query}"`);
      console.log(`       期望: ${test.expectedId}`);
      
      // 调用检索函数（使用混合检索）
      const results = await searchByFAQCacheAsync(test.query, 5, 0.05, true);
      
      if (!results || results.length === 0) {
        console.log(`       ❌ 未召回任何结果\n`);
        continue;
      }
      
      // 检查期望的FAQ是否在召回结果中
      const recalledIds = results.map(r => r.parentDocId || r.docId);
      const isRecalled = recalledIds.includes(test.expectedId);
      
      if (isRecalled) {
        console.log(`       ✅ 召回成功 (top ${recalledIds.findIndex(id => id === test.expectedId) + 1})`);
        recalled++;
        categoryStats[category].recalled++;
      } else {
        console.log(`       ❌ 未召回 (top ${recalledIds.length}: ${recalledIds.join(', ')})`);
      }
      
      console.log('');
    } catch (err) {
      console.error(`       ❌ 测试失败: ${err.message}\n`);
    }
  }
  
  // 计算总体召回率
  const recallRate = (recalled / totalTests * 100).toFixed(1);
  
  console.log('========================================');
  console.log('测试结果汇总');
  console.log('========================================');
  console.log(`总测试数: ${totalTests}`);
  console.log(`召回成功: ${recalled}`);
  console.log(`总体召回率: ${recallRate}%`);
  console.log('');
  
  console.log('分类型统计:');
  for (const [category, stats] of Object.entries(categoryStats)) {
    const rate = (stats.recalled / stats.total * 100).toFixed(1);
    console.log(`  ${category}: ${stats.recalled}/${stats.total} (${rate}%)`);
  }
  console.log('');
  
  // 判断是否达到目标
  if (parseFloat(recallRate) >= 85) {
    console.log('🎉 恭喜！召回率已达到目标（85%+）');
  } else {
    console.log(`⚠️  召回率未达标（目标85%+），当前 ${recallRate}%，继续优化...`);
  }
  
  return { recallRate, categoryStats };
}

// 执行测试
runTest()
  .then(result => {
    console.log('\n========================================');
    console.log('测试完成');
    console.log('========================================');
    
    // 保存测试结果
    const report = {
      testTime: new Date().toISOString(),
      totalTests: TEST_QUERIES.length,
      recalled: result.recalled,
      recallRate: result.recallRate,
      categoryStats: result.categoryStats,
      target: 85,
      passed: parseFloat(result.recallRate) >= 85
    };
    
    const reportPath = path.join(__dirname, 'recall-test-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`测试报告已保存: ${reportPath}`);
  })
  .catch(err => {
    console.error('测试执行失败:', err);
    process.exit(1);
  });
