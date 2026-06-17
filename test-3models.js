/**
 * 测试3个模型是否都在RAG流程中生效
 */

var https = require('https');
var http = require('http');

// 辅助函数：发送HTTP请求
function sendRequest(url, method, headers, body) {
  return new Promise(function(resolve, reject) {
    var parsedUrl = require('url').parse(url);
    var options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.path,
      method: method,
      headers: headers
    };
    
    var req = http.request(options, function(res) {
      var data = '';
      res.on('data', function(chunk) { data += chunk; });
      res.on('end', function() { resolve({ status: res.statusCode, data: data }); });
    });
    
    req.on('error', function(e) { reject(e); });
    if (body) req.write(body);
    req.end();
  });
}

// 测试嵌入模型
async function testEmbedModel(query) {
  console.log('\n[1/3] 测试嵌入模型 (bge-m3:latest)...');
  var start = Date.now();
  
  try {
    var body = JSON.stringify({
      model: 'bge-m3:latest',
      prompt: query
    });
    
    var res = await sendRequest('http://172.17.6.18:11434/api/embeddings', 'POST', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }, body);
    
    var cost = Date.now() - start;
    var data = JSON.parse(res.data);
    
    if (data.embedding && data.embedding.length > 0) {
      console.log('  ✅ 嵌入模型正常 (' + cost + 'ms)');
      console.log('     向量维度: ' + data.embedding.length);
      return true;
    } else {
      console.log('  ❌ 嵌入模型异常: ' + res.data.substring(0, 100));
      return false;
    }
  } catch (e) {
    console.log('  ❌ 嵌入模型调用失败: ' + e.message);
    return false;
  }
}

// 测试Rerank模型
async function testRerankModel(query) {
  console.log('\n[2/3] 测试Rerank模型 (bge-reranker-v2-m3)...');
  var start = Date.now();
  
  try {
    var body = JSON.stringify({
      query: query,
      documents: [
        '借款需要什么手续？',
        '费用报销流程是什么？',
        '营业执照怎么办理？'
      ],
      top_k: 3
    });
    
    var res = await sendRequest('http://172.17.6.18:8000/rerank', 'POST', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }, body);
    
    var cost = Date.now() - start;
    var data = JSON.parse(res.data);
    
    if (data.results && data.results.length > 0) {
      console.log('  ✅ Rerank模型正常 (' + cost + 'ms)');
      data.results.forEach(function(r, i) {
        console.log('     候选#' + (i+1) + ': ' + r.document_text + ' (score: ' + (r.score ? r.score.toFixed(4) : 'N/A') + ')');
      });
      return true;
    } else {
      console.log('  ❌ Rerank模型异常: ' + res.data.substring(0, 100));
      return false;
    }
  } catch (e) {
    console.log('  ❌ Rerank模型调用失败: ' + e.message);
    return false;
  }
}

// 测试LLM模型
async function testLLMModel(query) {
  console.log('\n[3/3] 测试LLM模型 (qwen2.5:14b)...');
  var start = Date.now();
  
  try {
    var body = JSON.stringify({
      model: 'qwen2.5:14b',
      messages: [
        { role: 'user', content: '请用一句话回答：' + query }
      ],
      max_tokens: 100,
      stream: false
    });
    
    var res = await sendRequest('http://172.17.6.18:11434/v1/chat/completions', 'POST', {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    }, body);
    
    var cost = Date.now() - start;
    var data = JSON.parse(res.data);
    
    if (data.choices && data.choices[0]) {
      console.log('  ✅ LLM模型正常 (' + cost + 'ms)');
      var reply = data.choices[0].message ? data.choices[0].message.content : 'N/A';
      console.log('     回复: ' + reply.substring(0, 80) + (reply.length > 80 ? '...' : ''));
      return true;
    } else {
      console.log('  ❌ LLM模型异常: ' + res.data.substring(0, 100));
      return false;
    }
  } catch (e) {
    console.log('  ❌ LLM模型调用失败: ' + e.message);
    return false;
  }
}

// 主测试流程
async function runTests() {
  var queries = ['一级城市', '借款需要什么手续'];
  
  for (var i = 0; i < queries.length; i++) {
    var query = queries[i];
    console.log('\n====== 测试查询: "' + query + '" ======');
    
    await testEmbedModel(query);
    await testRerankModel(query);
    await testLLMModel(query);
  }
  
  console.log('\n====== 所有测试完成！ ======');
  process.exit(0);
}

runTests();
