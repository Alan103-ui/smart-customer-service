/**
 * RAG 检索效果评估脚本
 * 用法：node scripts/rag-eval.js [--k=5] [--mode=hybrid|vector|bm25]
 *
 * 计算指标：
 * - Precision@K：top-K 结果中有多少是相关的？
 * - Recall@K：相关文档有多少在 top-K 中？
 * - MRR (Mean Reciprocal Rank)：第一个相关文档的排名的倒数
 * - NDCG (Normalized Discounted Cumulative Gain)：考虑相关文档的位置
 */

const path = require('path');
const fs = require('fs');

// 加载向量存储模块
const { searchByFAQCacheAsync, semanticSearch, bm25Search, buildBM25Index, loadStore, cosineSimilarity, setRRFWeights, getRRFWeights } = require('../server/vector-store');

const ARG_K = parseInt(process.argv.find(a => a.startsWith('--k='))?.split('=')[1] || '5');
const ARG_MODE = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'hybrid';
// 新增：权重参数（如 --weights=0.6,0.4 表示向量60%、BM25 40%）
const ARG_WEIGHTS = process.argv.find(a => a.startsWith('--weights='))?.split('=')[1];

// ============ 评估指标计算 ============

/**
 * 计算 Precision@K
 * @param {Array} results - 搜索结果 [{docId, score}]
 * @param {Set} relevantIds - 相关文档 ID 集合
 * @param {number} k - 取 top-K
 * @returns {number}
 */
function precisionAtK(results, relevantIds, k) {
  const topK = results.slice(0, k);
  const relevantCount = topK.filter(r => relevantIds.has(r.docId || r.parentDocId)).length;
  return topK.length > 0 ? relevantCount / topK.length : 0;
}

/**
 * 计算 Recall@K
 * @param {Array} results - 搜索结果
 * @param {Set} relevantIds - 相关文档 ID 集合
 * @param {number} k - 取 top-K
 * @returns {number}
 */
function recallAtK(results, relevantIds, k) {
  if (relevantIds.size === 0) return 0;
  const topK = results.slice(0, k);
  const retrievedRelevant = new Set(
    topK.filter(r => relevantIds.has(r.docId || r.parentDocId)).map(r => r.docId || r.parentDocId)
  );
  return retrievedRelevant.size / relevantIds.size;
}

/**
 * 计算 MRR (Mean Reciprocal Rank)
 * @param {Array} results - 搜索结果
 * @param {Set} relevantIds - 相关文档 ID 集合
 * @returns {number}
 */
function mrr(results, relevantIds) {
  for (let i = 0; i < results.length; i++) {
    const docId = results[i].docId || results[i].parentDocId;
    if (relevantIds.has(docId)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * 计算 NDCG@K
 * @param {Array} results - 搜索结果
 * @param {Set} relevantIds - 相关文档 ID 集合
 * @param {Object} relevanceScores - 文档相关度评分（可选，默认 1.0）
 * @param {number} k - 取 top-K
 * @returns {number}
 */
function ndcgAtK(results, relevantIds, relevanceScores = {}, k = 10) {
  const topK = results.slice(0, k);

  // 计算 DCG
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const docId = topK[i].docId || topK[i].parentDocId;
    const rel = relevantIds.has(docId) ? (relevanceScores[docId] || 1.0) : 0;
    dcg += rel / Math.log2(i + 2); // i+2 因为排名从 1 开始
  }

  // 计算 IDCG（理想 DCG）
  let idcg = 0;
  const sortedRelevant = [...relevantIds].sort((a, b) => (relevanceScores[b] || 1.0) - (relevanceScores[a] || 1.0));
  for (let i = 0; i < Math.min(sortedRelevant.length, k); i++) {
    const rel = relevanceScores[sortedRelevant[i]] || 1.0;
    idcg += rel / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

// ============ 主评估流程 ============

async function runEvaluation() {
  console.log('='.repeat(80));
  console.log('RAG 检索效果评估');
  console.log('='.repeat(80));
  console.log(`参数：K=${ARG_K}, mode=${ARG_MODE}`);
  
  // 解析并设置权重（如果提供了权重参数）
  let weights = null;
  if (ARG_WEIGHTS) {
    weights = ARG_WEIGHTS.split(',').map(w => parseFloat(w.trim()));
    if (weights.length >= 2) {
      try {
        setRRFWeights(weights);
        console.log(`✅ RRF 权重已设置: ${weights.map((w, i) => `检索${i + 1}:${w}`).join(', ')}`);
      } catch (e) {
        console.warn(`⚠️ 权重设置失败: ${e.message}，使用默认权重`);
        weights = null;
      }
    } else {
      console.warn(`⚠️ 权重参数格式错误，应为 --weights=0.6,0.4，使用默认权重`);
      weights = null;
    }
  } else {
    weights = getRRFWeights();
    console.log(`ℹ️ 使用默认 RRF 权重: ${weights.map((w, i) => `检索${i + 1}:${w}`).join(', ')}`);
  }
  console.log('');

  // 1. 加载 FAQ 数据（作为测试查询和 ground truth）
  const FAQ_PATH = path.join(__dirname, '../data/faq.json');
  if (!fs.existsSync(FAQ_PATH)) {
    console.error('FAQ 数据不存在，请先添加 FAQ');
    process.exit(1);
  }

  const faqList = JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8'));
  console.log(`加载了 ${faqList.length} 条 FAQ 作为测试查询`);

  // 2. 构建 BM25 索引（如果使用 hybrid 或 bm25 模式）
  if (ARG_MODE === 'hybrid' || ARG_MODE === 'bm25') {
    console.log('构建 BM25 索引...');
    buildBM25Index();
  }

  // 3. 对每个 FAQ 进行搜索和评估
  const allMetrics = [];
  const errors = [];

  for (let i = 0; i < faqList.length; i++) {
    const faq = faqList[i];
    const query = faq.question;
    const relevantId = faq.id; // Ground truth：这个问题对应的 FAQ ID

    try {
      let results = [];

      // 根据模式选择搜索方法
      if (ARG_MODE === 'hybrid') {
        // 混合检索：BM25 + 向量（使用 RRF 融合）
        results = await searchByFAQCacheAsync(query, ARG_K * 2, 0.10, true);
      } else if (ARG_MODE === 'bm25') {
        // 仅 BM25 搜索
        results = await searchByFAQCacheAsync(query, ARG_K * 2, 0.10, false);
      } else if (ARG_MODE === 'vector') {
        // 仅向量搜索：调用 semanticSearch（禁用 hybrid）
        results = await semanticSearch(query, ARG_K * 2, 0.10, true, false);
      } else if (ARG_MODE === 'bm25') {
        // 仅 BM25 搜索
        const bm25Results = bm25Search(query, ARG_K * 2, 0);
        // 需要转换为统一格式
        const store = loadStore();
        for (const r of bm25Results) {
          const chunk = store.chunks.find(c => (c.parentDocId || c.docId) === r.docId);
          if (chunk) {
            results.push({
              docId: r.docId,
              score: r.score,
              title: chunk.title,
              content: chunk.content
            });
          }
        }
      }

      // 计算指标
      const relevantIds = new Set([relevantId]);
      const prec = precisionAtK(results, relevantIds, ARG_K);
      const rec = recallAtK(results, relevantIds, ARG_K);
      const mrrScore = mrr(results, relevantIds);
      const ndcg = ndcgAtK(results, relevantIds, {}, ARG_K);

      // 检查 ground truth 是否在结果中
      const found = results.slice(0, ARG_K).some(r => (r.docId || r.parentDocId) === relevantId);

      allMetrics.push({
        query: query.slice(0, 50),
        precision: prec,
        recall: rec,
        mrr: mrrScore,
        ndcg: ndcg,
        found,
        topScore: results[0]?.score || 0
      });

      // 进度输出
      if ((i + 1) % 10 === 0) {
        process.stdout.write(`\r评估进度：${i + 1}/${faqList.length}`);
      }
    } catch (e) {
      errors.push({ query: faq.question.slice(0, 30), error: e.message });
    }
  }

  console.log(`\n完成 ${allMetrics.length} 条查询评估，${errors.length} 个错误`);

  // 4. 汇总指标
  console.log('');
  console.log('='.repeat(80));
  console.log('评估结果汇总');
  console.log('='.repeat(80));

  const avgPrecision = allMetrics.reduce((sum, m) => sum + m.precision, 0) / allMetrics.length;
  const avgRecall = allMetrics.reduce((sum, m) => sum + m.recall, 0) / allMetrics.length;
  const avgMrr = allMetrics.reduce((sum, m) => sum + m.mrr, 0) / allMetrics.length;
  const avgNdcg = allMetrics.reduce((sum, m) => sum + m.ndcg, 0) / allMetrics.length;
  const foundRate = allMetrics.filter(m => m.found).length / allMetrics.length;

  console.log(`\n模式：${ARG_MODE}`);
  console.log(`K值：${ARG_K}`);
  console.log(`测试查询数：${allMetrics.length}`);
  console.log('');
  console.log(`Precision@${ARG_K}：${(avgPrecision * 100).toFixed(2)}%`);
  console.log(`Recall@${ARG_K}：${(avgRecall * 100).toFixed(2)}%`);
  console.log(`MRR：${avgMrr.toFixed(4)}`);
  console.log(`NDCG@${ARG_K}：${avgNdcg.toFixed(4)}`);
  console.log(`Top-${ARG_K} 命中率：${(foundRate * 100).toFixed(2)}%`);

  // 5. 生成详细报告
  const report = {
    config: { k: ARG_K, mode: ARG_MODE, totalQueries: allMetrics.length, weights: weights || getRRFWeights() },
    metrics: {
      avgPrecision,
      avgRecall,
      avgMrr,
      avgNdcg,
      foundRate
    },
    details: allMetrics,
    errors
  };

  const reportPath = path.join(__dirname, `../data/rag-eval-report-${ARG_MODE}-k${ARG_K}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // 同时保存到固定路径（方便前端读取）
  const latestReportPath = path.join(__dirname, '../data/rag-eval-latest.json');
  fs.writeFileSync(latestReportPath, JSON.stringify(report, null, 2));
  
  console.log(`\n详细报告已保存至：${reportPath}`);
  console.log(`最新报告已保存至：${latestReportPath}`);

  // 6. 对比建议
  if (ARG_MODE === 'hybrid') {
    console.log('\n💡 建议：');
    console.log(`   运行 \`node scripts/rag-eval.js --mode=vector --k=${ARG_K}\` 对比纯向量搜索效果`);
    console.log(`   运行 \`node scripts/rag-eval.js --mode=bm25 --k=${ARG_K}\` 对比纯 BM25 搜索效果`);
  }
}

// 运行评估
runEvaluation().catch(e => {
  console.error('评估失败：', e);
  process.exit(1);
});
