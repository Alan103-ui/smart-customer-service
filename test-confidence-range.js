// 调试：找出置信度在0.6-0.8之间的消息
const path = require('path');
const fs = require('fs');

// 加载后端模块
const serverPath = path.join(__dirname, 'server');
eval(fs.readFileSync(path.join(serverPath, 'index.js'), 'utf8'));

// 测试消息
const testMessages = [
  '一类城市',  // 超高置信度
  '城市分类标准',  // 低置信度（0.57）
  '票务信息',
  '费用报销',
  '广康集团有哪些服务',
  '如何联系人工客服',
  '投诉电话',
  '工作时间',
  '退款政策',
  '配送范围'
];

async function testConfidence() {
  console.log('🚀 开始测试置信度...\n');
  
  for (const msg of testMessages) {
    try {
      const candidates = await searchFAQCandidates(msg, 0.12);
      
      if (candidates.length > 0) {
        const conf = candidates[0].confidence;
        let level = '超低';
        if (conf >= 0.8) level = '超高（直接返回）';
        else if (conf >= 0.7) level = '高（LLM改写）';
        else if (conf >= 0.6) level = '中（LLM改写）';
        else if (conf >= 0.4) level = '低（候选列表）';
        else level = '超低（转人工）';
        
        console.log(`"${msg}" → 置信度: ${conf.toFixed(4)} (${level})`);
        console.log(`    最佳匹配: "${candidates[0].faq.question}"`);
      } else {
        console.log(`"${msg}" → 无匹配`);
      }
    } catch (err) {
      console.error(`"${msg}" → 搜索失败: ${err.message}`);
    }
  }
}

testConfidence().then(() => {
  console.log('\n🎉 测试完成！');
  process.exit(0);
}).catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
