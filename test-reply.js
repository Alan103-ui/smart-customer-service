/**
 * 测试后端聊天回复功能（不依赖WebSocket）
 */

// 模拟加载server/index.js中的函数
// 由于server/index.js是一个完整的Express应用，我们直接测试vector-store和模拟调用

const fs = require('fs');
const path = require('path');

// 加载vector-store（不依赖Express）
const vectorStore = require('./server/vector-store');

// 模拟getFAQ函数
function getFAQ() {
  const FAQ_PATH = path.join(__dirname, 'data/faq.json');
  if (!fs.existsSync(FAQ_PATH)) return [];
  try { return JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8')); } catch (e) { return []; }
}

// 从server/index.js中提取的关键函数（避免加载整个Express应用）
const SYNONYM_MAP = {
  '一级': '一类', '二级': '二类', '三级': '三类', '四级': '四类', '五级': '五类',
  '1级': '一类', '2级': '二类', '3级': '三类',
};

function normalizeQuery(text) {
  let normalized = text.toLowerCase().replace(/[？?。，,、；;：:！!（）()\s]/g, '');
  for (const [from, to] of Object.entries(SYNONYM_MAP)) {
    normalized = normalized.replace(new RegExp(from, 'g'), to);
  }
  return normalized;
}

function quickLocalMatch(query, faqList) {
  const normalizedQuery = normalizeQuery(query);
  const results = [];

  for (const faq of faqList) {
    let score = 0;
    const normalizedQuestion = normalizeQuery(faq.question);

    if (normalizedQuestion === normalizedQuery) {
      score = 0.98;
    } else if (normalizedQuestion.includes(normalizedQuery)) {
      score = 0.90;
    } else if (normalizedQuery.includes(normalizedQuestion)) {
      score = 0.88;
    } else {
      if (faq.keywords && Array.isArray(faq.keywords)) {
        const normalizedKeywords = faq.keywords.map(k => normalizeQuery(k));
        for (const kw of normalizedKeywords) {
          if (normalizedQuery.includes(kw)) score += 0.25;
          if (kw.includes(normalizedQuery)) score += 0.20;
        }
      }
      const qWords = normalizedQuestion.split(/[的之是和与及或]/).filter(w => w.length >= 2);
      for (const w of qWords) {
        if (normalizedQuery.includes(w)) score += 0.08;
      }
    }

    if (score >= 0.35) {
      results.push({ faq, score: Math.min(score, 0.98) });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 5);
}

async function testSearchCandidates(query, faqList) {
  console.log(`\n=== 测试查询: "${query}" ===`);
  
  // 测试1: 本地快速匹配
  const start1 = Date.now();
  const localResults = quickLocalMatch(query, faqList);
  const cost1 = Date.now() - start1;
  console.log(`[本地快速匹配] 耗时: ${cost1}ms, 匹配: ${localResults.length}条`);
  if (localResults.length > 0) {
    localResults.forEach((r, i) => {
      console.log(`  [#${i+1}] ${r.faq.question} (score:${r.score.toFixed(2)})`);
    });
  }

  // 测试2: FAQ embedding缓存搜索（如果可用）
  try {
    const start2 = Date.now();
    const cacheResults = await vectorStore.searchByFAQCacheAsync(query, 5, 0.10);
    const cost2 = Date.now() - start2;
    console.log(`[FAQ缓存搜索] 耗时: ${cost2}ms, 匹配: ${cacheResults.length}条`);
    if (cacheResults.length > 0) {
      cacheResults.slice(0, 3).forEach((r, i) => {
        console.log(`  [#${i+1}] ${r.parentDocId} (score:${r.score?.toFixed(3) || 'N/A'})`);
      });
    }
  } catch (e) {
    console.log(`[FAQ缓存搜索] 失败: ${e.message}`);
  }

  return { localCost: cost1, localCount: localResults.length };
}

async function runTests() {
  const faqList = getFAQ();
  console.log(`加载FAQ: ${faqList.length}条`);

  const testQueries = [
    '一级城市',
    '借款',
    '费用报销',
    '营业执照怎么办理',
    '备用金',
    '二类城市',
    '北京上海广州深圳',
  ];

  const results = [];
  for (const q of testQueries) {
    const result = await testSearchCandidates(q, faqList);
    results.push({ query: q, ...result });
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n=== 测试总结 ===');
  console.log('查询 | 本地匹配耗时 | 匹配数');
  console.log('------|-------------|--------');
  results.forEach(r => {
    console.log(`${r.query.padEnd(16, ' ')} | ${r.localCost.toString().padEnd(11, ' ')} | ${r.localCount}`);
  });

  const avgCost = results.reduce((sum, r) => sum + r.localCost, 0) / results.length;
  console.log(`\n平均本地匹配耗时: ${avgCost.toFixed(1)}ms`);
  console.log('结论:', avgCost < 10 ? '✅ 本地匹配速度优秀！' : '⚠️ 本地匹配需要进一步优化');
}

runTests().catch(console.error);
