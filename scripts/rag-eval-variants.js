/**
 * 测试变体问题 - 评估RAG在实际场景中的表现
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_BASE = 'http://localhost:3001';
const FAQ_PATH = path.join(__dirname, '../data/faq.json');

// 变体问题（模拟用户真实提问）
const variantQuestions = [
  // faq_001: 财务管理原则是什么？
  { id: 'faq_001', variants: ['财务管理的原则有哪些？', '财务管理的原则', '什么是财务管理原则'] },
  
  // faq_002: 费用报销的会计确认要求是什么？
  { id: 'faq_002', variants: ['费用报销怎么确认？', '报销的会计要求', '费用报销会计处理'] },
  
  // faq_007: 费用报销需要什么材料？
  { id: 'faq_007', variants: ['报销要带什么？', '怎么报销费用？需要哪些材料？', '报销需要准备什么'] },
  
  // faq_005: 备用金申请条件和限额是什么？
  { id: 'faq_005', variants: ['怎么申请备用金？', '备用金最多能借多少？', '谁能申请备用金'] },
  
  // faq_013: 营业执照怎么办理？
  { id: 'faq_013', variants: ['如何办理营业执照', '营业执照申请流程', '办营业执照需要什么手续'] },
];

// 发送HTTP请求
function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : null;
    const urlObj = new URL(path, API_BASE);
    
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data, statusCode: res.statusCode });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

// 测试单个变体问题
async function testVariant(faqId, variant, idx) {
  try {
    const response = await apiRequest(
      '/api/eval/rag',
      'POST',
      { query: variant, threshold: 0.12, category: null }
    );

    if (!response.success) {
      return {
        faqId,
        variant,
        found: false,
        error: response.error || 'Unknown error'
      };
    }

    const candidates = response.candidates || [];
    const found = candidates.some(c => c.id === faqId);
    const topConfidence = candidates.length > 0 ? candidates[0].confidence : 0;

    return {
      faqId,
      variant,
      found,
      candidateCount: candidates.length,
      topConfidence,
      topId: candidates.length > 0 ? candidates[0].id : null,
      topQuestion: candidates.length > 0 ? candidates[0].question : null,
    };
  } catch (error) {
    return {
      faqId,
      variant,
      found: false,
      error: error.message
    };
  }
}

// 主函数
async function main() {
  console.log('开始测试变体问题...\n');
  console.log('='.repeat(60));

  const allResults = [];
  let totalTests = 0;
  let foundCount = 0;

  for (const item of variantQuestions) {
    console.log(`\n测试 FAq: ${item.id}`);
    console.log('-'.repeat(60));

    for (let i = 0; i < item.variants.length; i++) {
      const variant = item.variants[i];
      console.log(`  [${i + 1}] "${variant}"`);

      const result = await testVariant(item.id, variant, i);
      allResults.push(result);
      totalTests++;

      if (result.found) {
        foundCount++;
        console.log(`    检索到: ✅ (置信度: ${result.topConfidence.toFixed(4)})`);
      } else {
        console.log(`    检索到: ❌`);
        console.log(`    Top候选: ${result.topQuestion || '无'} (${result.topId || '无'})`);
      }

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // 计算指标
  const summary = {
    timestamp: new Date().toISOString(),
    totalTests,
    foundCount,
    foundRate: (foundCount / totalTests * 100).toFixed(2) + '%',
    details: allResults
  };

  // 保存结果
  const reportPath = path.join(
    __dirname,
    `../data/rag-eval-variants-${Date.now()}.json`
  );
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  // 打印摘要
  console.log('\n' + '='.repeat(60));
  console.log('变体问题测试完成！');
  console.log('='.repeat(60));
  console.log(`总测试数: ${totalTests}`);
  console.log(`检索成功: ${summary.foundRate} (${foundCount}/${totalTests})`);
  console.log('='.repeat(60));
  console.log(`报告已保存: ${reportPath}`);

  // 找出检索失败的变体
  console.log('\n检索失败的变体问题:');
  allResults.forEach((r) => {
    if (!r.found) {
      console.log(`  - "${r.variant}" (预期: ${r.faqId})`);
      console.log(`    实际Top: "${r.topQuestion}" (${r.topId})`);
    }
  });
}

// 执行
main().catch(console.error);
