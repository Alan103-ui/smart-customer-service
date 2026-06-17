/**
 * 测试bge-m3向量嵌入模型
 * 目的：检查bge-m3是否可用，并测试语义相似度计算
 */

const http = require('http');

// Ollama服务器配置（从ollama-client.js读取）
const OLLAMA_HOST = '172.17.6.18';
const OLLAMA_PORT = 11434;
const BGE_MODEL = 'bge-m3:latest';

/**
 * 调用Ollama embeddings API
 */
function getEmbedding(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({
      model: BGE_MODEL,
      prompt: text
    });
    
    const options = {
      hostname: OLLAMA_HOST,
      port: OLLAMA_PORT,
      path: '/api/embeddings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.embedding) {
            resolve(result.embedding);
          } else {
            reject(new Error('No embedding in response: ' + body));
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', (err) => {
      reject(err);
    });
    
    req.write(data);
    req.end();
  });
}

/**
 * 计算余弦相似度
 */
function cosineSimilarity(vec1, vec2) {
  if (!vec1 || !vec2 || vec1.length !== vec2.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (let i = 0; i < vec1.length; i++) {
    dotProduct += vec1[i] * vec2[i];
    norm1 += vec1[i] * vec1[i];
    norm2 += vec2[i] * vec2[i];
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// ============ 主测试流程 ============
async function runTests() {
  console.log('========== 测试bge-m3向量嵌入模型 ==========\n');
  
  // 测试1：获取单个文本的嵌入向量
  console.log('[测试1] 获取嵌入向量...');
  try {
    const embedding = await getEmbedding('如何申请报销');
    console.log(`  ✅ 嵌入向量维度: ${embedding.length}`);
    console.log(`  前10个值: [${embedding.slice(0, 10).map(v => v.toFixed(4)).join(', ')}...]`);
  } catch (err) {
    console.log(`  ❌ 获取嵌入向量失败: ${err.message}`);
    console.log('\n========== 建议 ==========');
    console.log('bge-m3模型可能未加载，请先在Ollama服务器上执行：');
    console.log('  ollama pull bge-m3:latest');
    console.log('或：');
    console.log('  ollama run bge-m3:latest');
    return;
  }
  
  // 测试2：计算语义相似度
  console.log('\n[测试2] 计算语义相似度...');
  try {
    const vec1 = await getEmbedding('如何申请报销');
    const vec2 = await getEmbedding('报销申请流程是什么');
    const vec3 = await getEmbedding('今天天气怎么样');
    
    const sim12 = cosineSimilarity(vec1, vec2);
    const sim13 = cosineSimilarity(vec1, vec3);
    
    console.log(`  ✅ "如何申请报销" vs "报销申请流程是什么": ${sim12.toFixed(4)}`);
    console.log(`  ✅ "如何申请报销" vs "今天天气怎么样": ${sim13.toFixed(4)}`);
    
    if (sim12 > sim13) {
      console.log('  ✅ 语义相似度计算正确：相关文本的相似度更高');
    } else {
      console.log('  ⚠️ 语义相似度计算异常：相关文本的相似度更低');
    }
  } catch (err) {
    console.log(`  ❌ 计算语义相似度失败: ${err.message}`);
  }
  
  console.log('\n========== 测试完成 ==========');
}

// 运行测试
runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
