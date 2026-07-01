/**
 * 测试不同阈值对变体问题检索效果的影响
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_BASE = 'http://localhost:3001';

// 变体问题（与之前相同）
const variantQuestions = [
  { id: 'faq_001', variants: ['财务管理的原则有哪些？', '财务管理的原则', '什么是财务管理原则'] },
  { id: 'faq_002', variants: ['费用报销怎么确认？', '报销的会计要求', '费用报销会计处理'] },
  { id: 'faq_007', variants: ['报销要带什么？', '怎么报销费用？需要哪些材料？', '报销需要准备什么'] },
  { id: 'faq_005', variants: ['怎么申请备用金？', '备用金最多能借多少？', '谁能申请备用金'] },
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
async function testVariant(faqId, variant, threshold) {
  try {
    const response = await apiRequest(
      '/api/eval/rag',
      'POST',
      { query: variant, threshold: threshold, category: null }
    );

    if (!response.success) {
      return { found: false, error: response.error };
    }

    const candidates = response.candidates || [];
    const found = candidates.some(c => c.id === faqId);
    const topConfidence = candidates.length > 0 ? candidates[0].confidence : 0;

    return {
      found,
      candidateCount: candidates.length,
      topConfidence,
      topId: candidates.length > 0 ? candidates[0].id : null,
    };
  } catch (error) {
    return { found: false, error: error.message };
  }
}

// 主函数
async function main() {
  console.log('测试不同阈值对变体问题检索的影响...\n');
  console.log('='.repeat(60));

  const thresholds = [0.01, 0.05, 0.12, 0.20, 0.30];
  const results = {};

  // 初始化结果
  thresholds.forEach(t => {
    results[t] = {
      total: 0,
      found: 0,
      details: []
    };
  });

  // 测试每个阈值
  for (const threshold of thresholds) {
    console.log(`\n测试阈值: ${threshold}`);
    console.log('-'.repeat(60));

    for (const item of variantQuestions) {
      for (const variant of item.variants) {
        process.stdout.write(`  "${variant.substring(0, 20)}..." `);

        const result = await testVariant(item.id, variant, threshold);
        results[threshold].total++;
        
        if (result.found) {
          results[threshold].found++;
          console.log(`✅ (confidence: ${result.topConfidence.toFixed(4)})`);
        } else {
          console.log(`❌ (top: ${result.topId || 'none'})`);
        }

        results[threshold].details.push({
          faqId: item.id,
          variant,
          found: result.found,
          topConfidence: result.topConfidence,
          topId: result.topId
        });

        // 避免请求过快
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  // 打印摘要
  console.log('\n' + '='.repeat(60));
  console.log('测试完成！');
  console.log('='.repeat(60));
  
  console.log('\n不同阈值的表现:');
  thresholds.forEach(t => {
    const rate = (results[t].found / results[t].total * 100).toFixed(2);
    console.log(`  阈值 ${t.toFixed(2)}: ${rate}% (${results[t].found}/${results[t].total})`);
  });

  // 保存结果
  const reportPath = path.join(__dirname, `../data/rag-eval-thresholds-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ thresholds, results }, null, 2));
  console.log(`\n报告已保存: ${reportPath}`);
}

// 执行
main().catch(console.error);
