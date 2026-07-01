// 测试RAG评估接口
const http = require('http');

const postData = JSON.stringify({
  query: '费用报销需要什么材料？',
  threshold: 0.12,
  category: null
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/eval/rag',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('状态:', res.statusCode);
    console.log('响应:', data);
    
    try {
      const json = JSON.parse(data);
      console.log('\n解析后的响应:');
      console.log('查询:', json.query);
      console.log('候选数量:', json.candidateCount);
      
      if (json.candidates && json.candidates.length > 0) {
        console.log('\n候选列表:');
        json.candidates.forEach((c, idx) => {
          console.log(`  ${idx + 1}. ${c.question} (置信度: ${c.confidence})`);
        });
      }
    } catch (e) {
      console.log('解析JSON失败:', e.message);
    }
  });
});

req.on('error', (err) => {
  console.error('请求错误:', err.message);
});

req.write(postData);
req.end();
