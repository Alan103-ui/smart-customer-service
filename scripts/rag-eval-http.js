/**
 * RAG完整评估脚本 - 通过HTTP API测试
 * 基于FAQ数据，测试检索质量
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const API_BASE = 'http://localhost:3001';
const FAQ_PATH = path.join(__dirname, '../data/faq.json');

// 读取FAQ数据
function loadFAQ() {
  return JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8'));
}

// 发送HTTP请求
function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(path, API_BASE);
    const postData = body ? JSON.stringify(body) : null;
    
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

// 测试RAG检索
async function testRAGRetrieval(query, expectedFaqId) {
  try {
    const response = await apiRequest(
      '/api/eval/rag',
      'POST',
      { query, threshold: 0.12, category: null }
    );

    if (!response.success) {
      return {
        query,
        expectedFaqId,
        found: false,
        error: response.error || 'Unknown error'
      };
    }

    const candidates = response.candidates || [];
    
    // 检查是否检索到预期的FAQ
    const found = candidates.some(c => c.id === expectedFaqId);
    
    // 计算指标
    const topConfidence = candidates.length > 0 ? candidates[0].confidence : 0;
    const avgConfidence = candidates.length > 0 
      ? candidates.reduce((sum, c) => sum + c.confidence, 0) / candidates.length 
      : 0;

    return {
      query,
      expectedFaqId,
      found,
      candidateCount: candidates.length,
      topConfidence,
      avgConfidence,
      topQuestion: candidates.length > 0 ? candidates[0].question : null,
      topId: candidates.length > 0 ? candidates[0].id : null,
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
  console.log('开始RAG完整评估 (HTTP API)...\n');
  console.log('='.repeat(60));

  const faqs = loadFAQ();
  console.log(`加载了 ${faqs.length} 条FAQ\n`);

  const results = [];
  
  // 测试每个FAQ的问题
  for (let i = 0; i < faqs.length; i++) {
    const faq = faqs[i];
    console.log(`[${i + 1}/${faqs.length}] 测试: ${faq.question}`);
    
    const result = await testRAGRetrieval(faq.question, faq.id);
    results.push(result);
    
    // 打印结果
    if (result.error) {
      console.log(`  ❌ 错误: ${result.error}`);
    } else {
      console.log(`  预期FAQ: ${faq.id}`);
      console.log(`  检索到: ${result.found ? '✅' : '❌'}`);
      console.log(`  Top候选: ${result.topQuestion || '无'} (${result.topId || '无'})`);
      console.log(`  置信度: ${result.topConfidence.toFixed(4)}`);
      console.log(`  候选数: ${result.candidateCount}`);
    }
    console.log('');

    // 避免请求过快
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // 计算总体指标
  const totalQueries = results.length;
  const foundCount = results.filter(r => r.found).length;
  const errorCount = results.filter(r => r.error).length;
  
  const avgTopConfidence = results
    .filter(r => !r.error)
    .reduce((sum, r) => sum + (r.topConfidence || 0), 0) / (totalQueries - errorCount);
  
  const avgCandidateCount = results
    .filter(r => !r.error)
    .reduce((sum, r) => sum + (r.candidateCount || 0), 0) / (totalQueries - errorCount);

  const summary = {
    timestamp: new Date().toISOString(),
    totalQueries,
    foundCount,
    foundRate: (foundCount / totalQueries * 100).toFixed(2) + '%',
    errorCount,
    avgTopConfidence: avgTopConfidence.toFixed(4),
    avgCandidateCount: avgCandidateCount.toFixed(2),
    details: results
  };

  // 保存结果
  const reportPath = path.join(
    __dirname,
    `../data/rag-eval-http-${Date.now()}.json`
  );
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
  
  // 保存为最新报告
  const latestPath = path.join(__dirname, '../data/rag-eval-latest.json');
  fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));

  // 打印摘要
  console.log('\n' + '='.repeat(60));
  console.log('评估完成！');
  console.log('='.repeat(60));
  console.log(`总查询数: ${totalQueries}`);
  console.log(`检索成功率: ${summary.foundRate} (${foundCount}/${totalQueries})`);
  console.log(`平均置信度: ${summary.avgTopConfidence}`);
  console.log(`平均候选数: ${summary.avgCandidateCount}`);
  console.log(`错误数: ${errorCount}`);
  console.log('='.repeat(60));
  console.log(`报告已保存: ${reportPath}`);
  
  // 找出检索失败的问题
  console.log('\n检索失败的问题:');
  results.forEach((r, idx) => {
    if (!r.found) {
      console.log(`  ${idx + 1}. ${r.query}`);
      console.log(`    预期: ${r.expectedFaqId}`);
      console.log(`    实际Top: ${r.topQuestion || '无'} (${r.topId || '无'})`);
      if (r.error) {
        console.log(`    错误: ${r.error}`);
      }
    }
  });
}

// 执行
main().catch(console.error);
