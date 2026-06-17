// 详细测试：看看HTTP请求到底发生了什么
const http = require('http');
const url = require('url');

const OLLAMA_URL = 'http://172.17.6.18:11434/v1/chat/completions';
const MODEL_NAME = 'qwen2.5:14b';

async function testHTTPRequest() {
  console.log('🚀 开始测试HTTP请求...');
  console.log(`   URL: ${OLLAMA_URL}`);
  console.log(`   Model: ${MODEL_NAME}\n`);

  const parsedUrl = new url.URL(OLLAMA_URL);
  console.log('解析后的URL：');
  console.log(`   hostname: ${parsedUrl.hostname}`);
  console.log(`   port: ${parsedUrl.port}`);
  console.log(`   path: ${parsedUrl.pathname}\n`);

  const systemPrompt = `你是智能客服，名字叫「小智」。请将【标准答案】改写成更自然的回复。`;
  const userPrompt = `【用户问题】：城市分类标准

【标准答案】：北京、上海、广州、深圳属于一类城市。

请直接返回改写后的回复：`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ];

  const payload = JSON.stringify({
    model: MODEL_NAME,
    messages: messages,
    temperature: 0.3,
    max_tokens: 300,
    stream: false
  });

  console.log('请求参数：');
  console.log(`   model: ${MODEL_NAME}`);
  console.log(`   messages数量: ${messages.length}`);
  console.log(`   payload长度: ${Buffer.byteLength(payload)} bytes\n`);

  console.log('🚀 发送HTTP请求...');

  const startTime = Date.now();

  try {
    const result = await new Promise((resolve, reject) => {
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 60000  // 60秒超时
      };

      console.log('HTTP请求选项：');
      console.log(`   hostname: ${options.hostname}`);
      console.log(`   port: ${options.port}`);
      console.log(`   path: ${options.path}`);
      console.log(`   method: ${options.method}`);
      console.log(`   timeout: ${options.timeout}ms\n`);

      const req = http.request(options, (res) => {
        console.log(`✅ 收到响应！`);
        console.log(`   状态码: ${res.statusCode}`);
        console.log(`   响应头: ${JSON.stringify(res.headers)}\n`);

        let data = '';
        let chunkCount = 0;

        res.on('data', (chunk) => {
          chunkCount++;
          data += chunk;
          console.log(`   [chunk ${chunkCount}] 收到 ${chunk.length} bytes`);
        });

        res.on('end', () => {
          const endTime = Date.now();
          console.log(`\n✅ 响应接收完成！`);
          console.log(`   总耗时: ${(endTime - startTime) / 1000}秒`);
          console.log(`   数据长度: ${data.length} bytes\n`);

          try {
            const parsed = JSON.parse(data);
            const rewritten = parsed.choices?.[0]?.message?.content?.trim();
            console.log(`✅ 解析成功！`);
            console.log(`   改写后答案: ${rewritten.substring(0, 100)}...\n`);
            resolve(rewritten);
          } catch (e) {
            console.error(`❌ 解析失败：`, e.message);
            console.error(`   原始数据: ${data.substring(0, 200)}...\n`);
            reject(e);
          }
        });
      });

      req.on('error', (err) => {
        const endTime = Date.now();
        console.error(`\n❌ 请求失败！`);
        console.error(`   错误: ${err.message}`);
        console.error(`   耗时: ${(endTime - startTime) / 1000}秒\n`);
        reject(err);
      });

      req.on('timeout', () => {
        const endTime = Date.now();
        console.error(`\n❌ 请求超时！`);
        console.error(`   超时时间: ${(endTime - startTime) / 1000}秒`);
        req.destroy();
        reject(new Error('请求超时'));
      });

      console.log('正在写入请求体...');
      req.write(payload);
      console.log('✅ 请求体已写入\n');

      console.log('正在发送请求...');
      req.end();
      console.log('✅ 请求已发送\n');
    });

    console.log(`\n🎉 测试成功！改写后答案：`);
    console.log(result);

  } catch (err) {
    console.error(`\n❌ 测试失败：`, err.message);
  }
}

testHTTPRequest();
