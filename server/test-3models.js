/**
 * RAG系统3个模型测试脚本
 * 测试：嵌入模型、Rerank模型、LLM模型
 */

const OLLAMA_API = 'http://172.17.6.18:11434/api';
const RERANK_API = 'http://172.17.6.18:8000';
const EMBEDDING_MODEL = 'bge-m3:latest';
const LLM_MODEL = 'qwen2.5:14b';

// 测试1：嵌入模型
async function testEmbeddingModel() {
  console.log('📊 测试1：嵌入模型（bge-m3:latest）');
  console.log('='.repeat(60));
  
  try {
    const response = await fetch(`${OLLAMA_API}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: '测试 embedding 模型是否正常工作'
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    
    if (!data.embedding || !Array.isArray(data.embedding)) {
      throw new Error('返回数据中没有 embedding 数组');
    }
    
    console.log('✅ 嵌入模型测试通过');
    console.log(`   模型：${EMBEDDING_MODEL}`);
    console.log(`   向量维度：${data.embedding.length}`);
    console.log(`   前5个值：[${data.embedding.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);
    console.log('');
    return true;
  } catch (error) {
    console.log('❌ 嵌入模型测试失败');
    console.log(`   错误：${error.message}`);
    console.log('');
    return false;
  }
}

// 测试2：Rerank模型
async function testRerankModel() {
  console.log('📋 测试2：Rerank模型（bge-reranker-v2-m3）');
  console.log('='.repeat(60));
  
  try {
    const query = '营业执照怎么办理';
    const documents = [
      '营业执照需要在工商局办理，需要提供身份证、经营场所证明等材料',
      '财务报销需要填写报销单，并附上发票和收据',
      '营业执照办理流程包括：名称核准、提交材料、领取执照等步骤'
    ];
    
    const response = await fetch(`${RERANK_API}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query,
        documents: documents
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    
    if (!data.results || !Array.isArray(data.results)) {
      throw new Error('返回数据中没有 results 数组');
    }
    
    console.log('✅ Rerank模型测试通过');
    console.log(`   服务地址：${RERANK_API}`);
    console.log(`   查询："${query}"`);
    console.log(`   文档数量：${documents.length}`);
    console.log(`   重排序结果：`);
    data.results.forEach((r, i) => {
      console.log(`     ${i+1}. [分数:${r.score.toFixed(4)}] ${r.document.slice(0, 40)}...`);
    });
    console.log('');
    return true;
  } catch (error) {
    console.log('❌ Rerank模型测试失败');
    console.log(`   错误：${error.message}`);
    console.log('');
    return false;
  }
}

// 测试3：LLM模型
async function testLLMModel() {
  console.log('📏 测试3：LLM模型（qwen2.5:14b）');
  console.log('='.repeat(60));
  
  try {
    const prompt = '请用一句话介绍什么是营业执照';
    
    const response = await fetch(`${OLLAMA_API}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.7,
          max_tokens: 100
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }
    
    const data = await response.json();
    
    if (!data.response) {
      throw new Error('返回数据中没有 response 字段');
    }
    
    console.log('✅ LLM模型测试通过');
    console.log(`   模型：${LLM_MODEL}`);
    console.log(`   提示词："${prompt}"`);
    console.log(`   生成回复："${data.response.slice(0, 100)}..."`);
    console.log(`   生成速度：${data.eval_count / data.eval_duration * 1e9 || 0} tokens/s`);
    console.log('');
    return true;
  } catch (error) {
    console.log('❌ LLM模型测试失败');
    console.log(`   错误：${error.message}`);
    console.log('');
    return false;
  }
}

// 测试4：完整RAG流程
async function testRAGPipeline() {
  console.log('🚀 测试4：完整RAG流程（3个模型协同）');
  console.log('='.repeat(60));
  
  try {
    // 4.1 使用嵌入模型进行语义搜索
    console.log('步骤1：使用嵌入模型进行语义搜索...');
    const query = '营业执照怎么办理';
    
    // 获取查询的嵌入向量
    const embedResponse = await fetch(`${OLLAMA_API}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: query
      })
    });
    
    if (!embedResponse.ok) {
      throw new Error(`嵌入失败：HTTP ${embedResponse.status}`);
    }
    
    const embedData = await embedResponse.json();
    console.log(`   ✅ 查询嵌入完成（维度：${embedData.embedding.length}）`);
    
    // 4.2 模拟搜索结果（实际应该从向量库搜索）
    const candidateDocs = [
      '营业执照需要在工商局办理，需要提供身份证、经营场所证明等材料',
      '财务报销需要填写报销单，并附上发票和收据',
      '营业执照办理流程包括：名称核准、提交材料、领取执照等步骤',
      '办理营业执照需要先进行名称预先核准，然后提交设立登记申请书'
    ];
    
    // 4.3 使用Rerank模型重排序
    console.log('步骤2：使用Rerank模型重排序...');
    const rerankResponse = await fetch(`${RERANK_API}/rerank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query,
        documents: candidateDocs
      })
    });
    
    if (!rerankResponse.ok) {
      throw new Error(`Rerank失败：HTTP ${rerankResponse.status}`);
    }
    
    const rerankData = await rerankResponse.json();
    const topDoc = rerankData.results[0].document;
    console.log(`   ✅ 重排序完成，最相关文档："${topDoc.slice(0, 30)}..."`);
    
    // 4.4 使用LLM生成回复
    console.log('步骤3：使用LLM模型生成回复...');
    const llmPrompt = `基于以下参考信息回答问题：\n\n参考信息：${topDoc}\n\n问题：${query}\n\n请生成简洁的回答：`;
    
    const llmResponse = await fetch(`${OLLAMA_API}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LLM_MODEL,
        prompt: llmPrompt,
        stream: false,
        options: {
          temperature: 0.7,
          max_tokens: 200
        }
      })
    });
    
    if (!llmResponse.ok) {
      throw new Error(`LLM失败：HTTP ${llmResponse.status}`);
    }
    
    const llmData = await llmResponse.json();
    console.log(`   ✅ LLM生成回复："${llmData.response.slice(0, 80)}..."`);
    
    console.log('');
    console.log('✅ 完整RAG流程测试通过！');
    console.log('');
    return true;
  } catch (error) {
    console.log('❌ 完整RAG流程测试失败');
    console.log(`   错误：${error.message}`);
    console.log('');
    return false;
  }
}

// 主测试函数
async function runAllTests() {
  console.log('');
  console.log('📊 RAG系统3个模型测试');
  console.log('='.repeat(60));
  console.log('');
  
  const results = {
    embedding: await testEmbeddingModel(),
    rerank: await testRerankModel(),
    llm: await testLLMModel(),
    ragPipeline: await testRAGPipeline()
  };
  
  console.log('📋 测试总结');
  console.log('='.repeat(60));
  console.log(`嵌入模型（bge-m3:latest）：${results.embedding ? '✅ 正常' : '❌ 异常'}`);
  console.log(`Rerank模型（bge-reranker-v2-m3）：${results.rerank ? '✅ 正常' : '❌ 异常'}`);
  console.log(`LLM模型（qwen2.5:14b）：${results.llm ? '✅ 正常' : '❌ 异常'}`);
  console.log(`完整RAG流程：${results.ragPipeline ? '✅ 正常' : '❌ 异常'}`);
  console.log('');
  
  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    console.log('🎉 所有测试通过！RAG系统3个模型均正常工作。');
  } else {
    console.log('⚠️  部分测试失败，请检查上述错误信息。');
  }
  
  console.log('');
}

// 运行测试
runAllTests().catch(error => {
  console.error('测试运行失败：', error);
  process.exit(1);
});
