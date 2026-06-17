/**
 * 测试答案改写模块
 * 测试内容：
 * 1. 直接函数调用（rewriteToColloquial）
 * 2. 批量改写（batchRewrite）
 * 3. 质量评估（evaluateQuality）
 * 4. 语气列表（getToneList）
 */

const {
  rewriteToColloquial,
  batchRewrite,
  evaluateQuality,
  getToneList
} = require('./answer-rewriter');

// ============ 测试用例 ============
const testCases = [
  {
    originalAnswer: '您的报销申请已批准，请在3个工作日内查收。',
    userMessage: '我的报销怎么样了',
    description: '测试1：报销申请批准'
  },
  {
    originalAnswer: '系统维护时间为每周三晚上22:00-24:00，届时将暂停服务。',
    userMessage: '系统什么时候维护',
    description: '测试2：系统维护通知'
  },
  {
    originalAnswer: '很抱歉给您带来不便。经查询，您的订单已发货，预计2天后到达。',
    userMessage: '我的订单在哪',
    description: '测试3：订单发货通知（有情绪识别）'
  }
];

// ============ 测试函数 ============

async function runTests() {
  console.log('========== 开始测试答案改写模块 ==========\n');
  
  let passedTests = 0;
  let totalTests = testCases.length;
  
  for (const testCase of testCases) {
    console.log(`\n[测试] ${testCase.description}`);
    console.log(`  原答案: ${testCase.originalAnswer}`);
    console.log(`  用户消息: ${testCase.userMessage}`);
    
    try {
      const rewritten = await rewriteToColloquial(testCase.originalAnswer, {
        userMessage: testCase.userMessage,
        tone: 'friendly'
      });
      
      console.log(`  ✅ 改写结果: ${rewritten}`);
      
      // 检查是否保持原意
      const keepMeaning = checkKeepMeaning(testCase.originalAnswer, rewritten);
      if (keepMeaning) {
        console.log(`  ✅ 保持原意: 是`);
        passedTests++;
      } else {
        console.log(`  ⚠️ 保持原意: 可能偏离`);
      }
      
      // 检查是否更口语化
      const moreColloquial = checkMoreColloquial(testCase.originalAnswer, rewritten);
      if (moreColloquial) {
        console.log(`  ✅ 更口语化: 是`);
      } else {
        console.log(`  ⚠️ 更口语化: 不明显`);
      }
      
    } catch (err) {
      console.log(`  ❌ 改写失败: ${err.message}`);
    }
  }
  
  // 测试批量改写
  console.log('\n\n[批量测试] 批量改写答案...');
  try {
    const items = testCases.map(t => ({ original: t.originalAnswer }));
    const results = await batchRewrite(items, {
      tone: 'friendly'
    });
    
    console.log(`  ✅ 批量改写完成: ${results.length} 条`);
    results.forEach((r, i) => {
      console.log(`    ${i+1}. 成功: ${r.success}, 改写后: ${r.rewritten.slice(0, 50)}...`);
    });
  } catch (err) {
    console.log(`  ❌ 批量改写失败: ${err.message}`);
  }
  
  // 测试质量评估
  console.log('\n\n[质量测试] 质量评估...');
  try {
    const quality = await evaluateQuality(
      '您的报销申请已批准，请在3个工作日内查收。',
      '您好呀！您的报销申请已经通过啦~请在3个工作日内查收哦！'
    );
    
    console.log(`  ✅ 质量评分: ${quality.overallScore}`);
    console.log(`     流畅度: ${quality.fluency}`);
    console.log(`     自然度: ${quality.naturalness}`);
    console.log(`     信息保留率: ${quality.infoRetention}`);
    console.log(`     口语化程度: ${quality.colloquialism}`);
  } catch (err) {
    console.log(`  ❌ 质量评估失败: ${err.message}`);
  }
  
  // 测试语气列表
  console.log('\n\n[配置测试] 语气列表...');
  try {
    const tones = getToneList();
    console.log(`  ✅ 可用语气: ${tones.map(t => t.name).join(', ')}`);
    tones.forEach(t => {
      console.log(`    - ${t.id}: ${t.name} (${t.description})`);
    });
  } catch (err) {
    console.log(`  ❌ 获取语气列表失败: ${err.message}`);
  }
  
  // 输出测试统计
  console.log('\n\n========== 测试统计 ==========');
  console.log(`通过测试: ${passedTests}/${totalTests}`);
  console.log(`总测试用例: ${testCases.length + 3}`); // +3 for batch, quality, tones
  console.log('========== 测试完成 ==========');
}

/**
 * 检查是否保持原意（简单实现）
 */
function checkKeepMeaning(original, rewritten) {
  // 简单检查：关键实体是否保留
  const keywords = ['报销', '批准', '维护', '订单', '发货'];
  let keepCount = 0;
  
  for (const keyword of keywords) {
    if (original.includes(keyword) && rewritten.includes(keyword)) {
      keepCount++;
    }
  }
  
  return keepCount > 0;
}

/**
 * 检查是否更口语化（简单实现）
 */
function checkMoreColloquial(original, rewritten) {
  // 简单检查：是否包含口语化词汇
  const colloquialMarkers = ['呀', '啦', '哦', '嗯', '哇', '~', '！'];
  
  for (const marker of colloquialMarkers) {
    if (rewritten.includes(marker) && !original.includes(marker)) {
      return true;
    }
  }
  
  return false;
}

// 运行测试
runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
