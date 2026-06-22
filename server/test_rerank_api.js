const http = require('http');

const data = JSON.stringify({
  query: '如何报销',
  documents: ['报销流程说明', '付款申请流程', '费用报销管理制度']
});

const options = {
  hostname: '172.17.6.18',
  port: 8000,
  path: '/rerank',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

console.log('发送 Rerank API 请求...');
console.log('请求数据:', data);

const req = http.request(options, (res) => {
  console.log(`状态码: ${res.statusCode}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('响应:', responseData);
  });
});

req.on('error', (e) => {
  console.error(`请求错误: ${e.message}`);
});

req.write(data);
req.end();
