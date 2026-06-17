// 调试：测试"城市分类标准"的置信度
const path = require('path');
const fs = require('fs');

// 加载后端模块（不启动服务器）
const serverPath = path.join(__dirname, 'server');

// 手动加载需要的函数和变量
eval(fs.readFileSync(path.join(serverPath, 'index.js'), 'utf8'));

// 测试搜索
async function testSearch() {
  console.log('🚀 开始测试搜索...\n');
  
  const testQueries = [
    '一类城市',
    '城市分类标准',
    '票务信息',
    '你们的服务太差了'
  ];
  
  for (const query of testQueries) {
    console.log(`测试查询: "${query}"`);
    
    try {
      const candidates = await searchFAQCandidates(query, 0.12);
      
      if (candidates.length > 0) {
        console.log(`  ✅ 找到 ${candidates.length} 个候选`);
        console.log(`     最佳匹配: "${candidates[0].faq.question}"`);
        console.log(`     置信度: ${candidates[0].confidence.toFixed(4)}`);
        console.log(`     阈值判断:`);
        console.log(`       超高置信度 (≥0.8): ${candidates[0].confidence >= 0.8}`);
        console.log(`       高置信度 (≥0.6): ${candidates[0].confidence >= 0.6}`);
        console.log(`       低置信度 (<0.6): ${candidates[0].confidence < 0.6}`);
      } else {
        console.log(`  ❌ 没有找到候选（无匹配）`);
      }
    } catch (err) {
      console.error(`  ❌ 搜索失败: ${err.message}`);
    }
    
    console.log('');  // 空行
  }
}

testSearch().then(() => {
  console.log('🎉 测试完成！');
  process.exit(0);
}).catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
