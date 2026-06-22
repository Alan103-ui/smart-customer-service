const { rerankResults } = require('./vector-store.js');

async function test() {
  const query = '如何报销';
  const candidates = [
    { content: '报销流程说明', title: '报销流程' },
    { content: '付款申请流程', title: '付款申请' },
    { content: '费用报销管理制度', title: '费用报销' }
  ];
  
  console.log('开始测试 rerankResults 函数...');
  console.log('查询:', query);
  console.log('候选数:', candidates.length);
  
  try {
    const result = await rerankResults(query, candidates, 5);
    console.log('重排序结果:');
    result.forEach((r, i) => {
      console.log(`  ${i+1}. ${r.title} (score: ${r.rerankScore})`);
    });
    console.log('✅ 测试通过');
  } catch (e) {
    console.error('❌ 测试失败:', e.message);
    console.error(e.stack);
  }
}

test();
