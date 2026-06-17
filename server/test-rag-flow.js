/**
 * 测试RAG搜索流程
 * 验证semanticSearch()返回的结果是否能正确匹配到FAQ
 */
const fs = require('fs');
const path = require('path');
const { semanticSearch, getStats } = require('./vector-store');

async function test() {
  console.log('=== RAG搜索流程测试 ===\n');
  
  // 1. 检查向量库统计
  const stats = getStats();
  console.log('📊 向量库统计:');
  console.log('  总块数:', stats.totalChunks);
  console.log('  唯一文档数:', stats.uniqueDocs);
  console.log('  嵌入模型:', stats.embeddingModel);
  console.log('  块类型分布:', JSON.stringify(stats.chunkTypes));
  console.log('');
  
  // 2. 加载FAQ列表
  const FAQ_PATH = path.join(__dirname, '../data/faq.json');
  const faqList = JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8'));
  console.log('📋 FAQ列表:');
  console.log('  总数:', faqList.length);
  faqList.forEach((f, i) => {
    console.log(`  ${i+1}. [${f.id}] ${f.question.slice(0, 40)}...`);
  });
  console.log('');
  
  // 3. 测试语义搜索
  const testQuery = '营业执照怎么办理';
  console.log(`🔍 语义搜索测试: "${testQuery}"`);
  
  try {
    const results = await semanticSearch(testQuery, 5, 0.12, true);
    console.log(`  搜索结果数量: ${results.length}`);
    console.log('');
    
    if (results.length === 0) {
      console.log('❌ 没有搜索结果！');
      return;
    }
    
    // 4. 检查搜索结果的结构
    console.log('📋 搜索结果详情:');
    results.forEach((r, i) => {
      console.log(`\n  结果${i+1}:`);
      console.log(`    docId: ${r.docId}`);
      console.log(`    parentDocId: ${r.parentDocId}`);
      console.log(`    chunkType: ${r.chunkType}`);
      console.log(`    title: ${r.title}`);
      console.log(`    score: ${r.score?.toFixed(4)}`);
      console.log(`    rerankScore: ${r.rerankScore?.toFixed(4)}`);
      console.log(`    text前100字: ${r.text?.slice(0, 100)}...`);
      
      // 5. 尝试匹配到FAQ
      const faqId = r.parentDocId;
      if (!faqId) {
        console.log(`    ❌ 缺少parentDocId，无法匹配FAQ`);
        return;
      }
      
      const faq = faqList.find(f => f.id === faqId);
      if (!faq) {
        console.log(`    ❌ 找不到FAQ (id=${faqId})`);
      } else {
        console.log(`    ✅ 匹配到FAQ: ${faq.question.slice(0, 40)}...`);
      }
    });
    
    // 6. 模拟searchFAQCandidates()的逻辑
    console.log('\n🔄 模拟searchFAQCandidates()逻辑:');
    const candidates = [];
    for (const r of results) {
      const faqId = r.parentDocId;
      if (!faqId) { console.log(`  跳过: 缺少parentDocId`); continue; }
      const faq = faqList.find(f => f.id === faqId);
      if (!faq) { console.log(`  跳过: 找不到FAQ (id=${faqId})`); continue; }
      if (candidates.some(c => c.faq.id === faq.id)) { console.log(`  跳过: FAQ已存在 (${faq.question.slice(0, 30)}...)`); continue; }
      const score = r.rerankScore !== undefined ? r.rerankScore : r.score;
      candidates.push({ faq, confidence: score, intent: faq.intent });
      console.log(`  ✅ 添加候选: "${faq.question}" (相关度: ${score.toFixed(4)})`);
    }
    console.log(`\n📊 最终候选数量: ${candidates.length}`);
    
  } catch (e) {
    console.error('❌ 测试失败:', e.message);
    console.error(e.stack);
  }
}

test();
