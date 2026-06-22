const { semanticSearch } = require('./vector-store.js');

async function test() {
  const query = '如何申请费用报销';
  
  console.log('开始测试 semanticSearch 函数...');
  console.log('查询:', query);
  
  try {
    const results = await semanticSearch(query, 5, 0.10, true, true);
    console.log('搜索结果:');
    results.forEach((r, i) => {
      console.log(`  ${i+1}. ${r.question || r.content?.slice(0, 30)} (score: ${r.score?.toFixed(4)})`);
    });
    console.log('✅ 测试通过');
  } catch (e) {
    console.error('❌ 测试失败:', e.message);
    console.error(e.stack);
  }
}

test();
