var http = require('http');

var payload = JSON.stringify({
  query: "一级城市",
  documents: ["一类城市有哪些？", "借款需要什么手续？"]
});

var options = {
  hostname: '172.17.6.18',
  port: 8000,
  path: '/rerank',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log("发送Rerank请求...");
console.log("请求体:", payload);

var req = http.request(options, function(res) {
  var data = '';
  res.on('data', function(chunk) { data += chunk; });
  res.on('end', function() {
    console.log("\n响应状态码:", res.statusCode);
    console.log("响应体:", data);
    
    try {
      var parsed = JSON.parse(data);
      console.log("\n解析后的结果:");
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e) {
      console.log("解析失败:", e.message);
    }
    
    process.exit(0);
  });
});

req.on('error', function(e) {
  console.error("请求失败:", e.message);
  process.exit(1);
});

req.write(payload);
req.end();
