// 简单测试脚本 - 验证 RAG 升级效果
const path = require('path');
const vectorStore = require('./vector-store.js');

const testQueries = [
  '一类城市',
  '费用报销流程',
  '备用金怎么申请',
  '财务制度是什么',
  '公司有哪些福利'
];

async function runTests() {
  console.log('🧪 RAG 升级效果测试\n');
  console.log('向量库统计：');
  const stats = vectorStore.getStats();
  console.log(JSON.stringify(stats, null, 2));
  console.log('');

  for (const query of testQueries) {
    console.log(`\n🔍 测试问题: "${query}"`);
    try {
      const results = await vectorStore.semanticSearch(query, 3, 0.12, true);
      if (results.length === 0) {
        console.log('  ❌ 无结果（阈值 0.12 下未找到相关文档）');
      } else {
        results.forEach((r, i) => {
          const score = r.rerankScore !== undefined ? r.rerankScore : r.score;
          const type = r.chunkType || 'unknown';
          console.log(`  ${i+1}. [${type}] 相关度: ${(score * 100).toFixed(1)}% - ${r.content.slice(0, 60)}...`);
        });
      }
    } catch (e) {
      console.log(`  ❌ 错误: ${e.message}`);
    }
  }
}

runTests().then(() => {
  console.log('\n✅ 测试完成');
  process.exit(0);
}).catch(e => {
  console.error('测试失败:', e);
  process.exit(1);
});
