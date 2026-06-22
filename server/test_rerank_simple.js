// 测试 Rerank API
const http = require('http');

const query = "如何报销";
const documents = [
  "报销流程说明文档",
  "付款申请流程", 
  "费用报销管理制度",
  "差旅费报销标准"
];

const payload = JSON.stringify({ query, documents });

const options = {
  hostname: '172.17.6.18',
  port: 8000,
  path: '/rerank',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('发送 Rerank 请求...');
console.log('查询:', query);
console.log('文档数:', documents.length);

const req = http.request(options, (res) => {
  console.log('状态码:', res.statusCode);
  
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('响应:', data);
    
    try {
      const parsed = JSON.parse(data);
      if (parsed.results && Array.isArray(parsed.results)) {
        console.log('\n✅ Rerank API 正常工作！');
        console.log('重排序结果:');
        parsed.results.forEach((r, i) => {
          console.log(`  ${i+1}. [${r.score.toFixed(4)}] ${r.document}`);
        });
      } else if (parsed.error) {
        console.log('\n❌ 错误:', parsed.error);
      }
    } catch (e) {
      console.log('解析响应失败:', e.message);
    }
  });
});

req.on('error', (e) => {
  console.error('请求失败:', e.message);
});

req.write(payload);
req.end();
