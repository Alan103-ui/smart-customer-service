/**
 * RAG完整评估脚本
 * 基于FAQ数据，测试检索和回答质量
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_BASE = 'http://localhost:3001';

// 读取FAQ数据
function loadFAQ() {
  const faqPath = path.join(__dirname, '../data/faq.json');
  return JSON.parse(fs.readFileSync(faqPath, 'utf8'));
}

// 发送HTTP请求
function apiRequest(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// 测试RAG检索
async function testRAGRetrieval(query, expectedFaqId) {
  try {
    // 调用RAG查询接口
    const response = await apiRequest(
      `${API_BASE}/api/chat/rag-query`,
      'POST',
      { query, sessionId: `eval_${Date.now()}`, userId: 'evaluator' }
    );

    const results = response.results || [];
    const answer = response.answer || '';

    // 计算指标
    const found = results.some(r => {
      // 检查是否检索到预期的FAQ
      if (expectedFaqId) {
        return r.id === expectedFaqId || 
               (r.metadata && r.metadata.id === expectedFaqId);
      }
      return false;
    });

    // 计算相似度分数
    const topScore = results.length > 0 ? results[0].score || 0 : 0;
    const avgScore = results.length > 0 
      ? results.reduce((sum, r) => sum + (r.score || 0), 0) / results.length 
      : 0;

    return {
      query,
      expectedFaqId,
      found,
      resultCount: results.length,
      topScore,
      avgScore,
      answer: answer.substring(0, 200), // 只取前200字符
      hasAnswer: answer.length > 0
    };
  } catch (error) {
    return {
      query,
      expectedFaqId,
      found: false,
      error: error.message
    };
  }
}

// 主函数
async function main() {
  console.log('开始RAG完整评估...\n');

  const faqs = loadFAQ();
  console.log(`加载了 ${faqs.length} 条FAQ\n`);

  const results = [];
  
  // 测试每个FAQ的问题
  for (let i = 0; i < faqs.length; i++) {
    const faq = faqs[i];
    console.log(`[${i + 1}/${faqs.length}] 测试: ${faq.question}`);
    
    const result = await testRAGRetrieval(faq.question, faq.id);
    results.push(result);
    
    console.log(`  预期FAQ: ${faq.id}`);
    console.log(`  检索到: ${result.found ? '✅' : '❌'}`);
    console.log(`  结果数: ${result.resultCount}`);
    console.log(`  Top分数: ${result.topScore.toFixed(4)}`);
    console.log(`  有回答: ${result.hasAnswer ? '✅' : '❌'}`);
    
    if (result.error) {
      console.log(`  错误: ${result.error}`);
    }
    
    console.log('');
    
    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // 计算总体指标
  const totalQueries = results.length;
  const foundCount = results.filter(r => r.found).length;
  const hasAnswerCount = results.filter(r => r.hasAnswer).length;
  const errorCount = results.filter(r => r.error).length;
  
  const avgTopScore = results.reduce((sum, r) => sum + (r.topScore || 0), 0) / totalQueries;
  const avgResultCount = results.reduce((sum, r) => sum + (r.resultCount || 0), 0) / totalQueries;

  const summary = {
    timestamp: new Date().toISOString(),
    totalQueries,
    foundCount,
    foundRate: (foundCount / totalQueries * 100).toFixed(2) + '%',
    hasAnswerCount,
    hasAnswerRate: (hasAnswerCount / totalQueries * 100).toFixed(2) + '%',
    errorCount,
    avgTopScore: avgTopScore.toFixed(4),
    avgResultCount: avgResultCount.toFixed(2),
    details: results
  };

  // 保存结果
  const reportPath = path.join(
    __dirname,
    `../data/rag-eval-full-${Date.now()}.json`
  );
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  
  // 保存为最新报告
  const latestPath = path.join(__dirname, '../data/rag-eval-latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));

  // 打印摘要
  console.log('='.repeat(60));
  console.log('评估完成！');
  console.log('='.repeat(60));
  console.log(`总查询数: ${totalQueries}`);
  console.log(`检索成功率: ${summary.foundRate} (${foundCount}/${totalQueries})`);
  console.log(`回答成功率: ${summary.hasAnswerRate} (${hasAnswerCount}/${totalQueries})`);
  console.log(`错误数: ${errorCount}`);
  console.log(`平均Top分数: ${summary.avgTopScore}`);
  console.log(`平均结果数: ${summary.avgResultCount}`);
  console.log('='.repeat(60));
  console.log(`报告已保存: ${reportPath}`);
  
  // 找出回答不好的问题
  console.log('\n问题列表:');
  results.forEach((r, idx) => {
    if (!r.found || !r.hasAnswer) {
      console.log(`  ${idx + 1}. ${r.query}`);
      console.log(`    检索: ${r.found ? '✅' : '❌'}  回答: ${r.hasAnswer ? '✅' : '❌'}`);
    }
  });
}

// 执行
main().catch(console.error);
