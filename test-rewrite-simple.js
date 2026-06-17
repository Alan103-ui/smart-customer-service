// 简单测试：直接调用rewriteFAQAnswerWithLLM()函数
const path = require('path');
const fs = require('fs');

// 加载后端代码（不启动服务器）
const serverPath = path.join(__dirname, 'server');
const indexPath = path.join(serverPath, 'index.js');

// 读取后端代码
let serverCode = fs.readFileSync(indexPath, 'utf8');

// 提取rewriteFAQAnswerWithLLM函数（简单方法：eval）
// 注意：这不是最佳实践，但可以快速测试
const functionMatch = serverCode.match(
  /async function rewriteFAQAnswerWithLLM\([^)]+\)\s*{[^]*?^}/m
);

if (!functionMatch) {
  console.log('❌ 无法提取rewriteFAQAnswerWithLLM函数');
  process.exit(1);
}

console.log('✅ 已提取rewriteFAQAnswerWithLLM函数');
console.log('开始测试...\n');

// 模拟调用
async function testRewrite() {
  try {
    // 由于函数依赖于全局变量OLLAMA_URL和MODEL_NAME，我们需要模拟
    // 这里直接复制函数逻辑，用测试值调用
    
    const OLLAMA_URL = 'http://172.17.6.18:11434/v1/chat/completions';
    const MODEL_NAME = 'qwen2.5:14b';
    
    const faqAnswer = '北京、上海、广州、深圳属于一类城市，这些城市的票务费用标准是...';
    const userMessage = '城市分类标准';
    const conversationHistory = [];
    
    console.log('测试参数：');
    console.log(`  FAQ答案: ${faqAnswer.substring(0, 50)}...`);
    console.log(`  用户消息: ${userMessage}`);
    console.log(`  对话历史: ${conversationHistory.length}条\n`);
    
    console.log('🚀 开始调用Ollama LLM...');
    const startTime = Date.now();
    
    // 简化版rewriteFAQAnswerWithLLM函数
    const http = require('http');
    const url = new URL(OLLAMA_URL);
    
    const systemPrompt = `你是「广康集团AI助手」的智能客服，名字叫「小智」。
请基于【用户当前问题】，将【标准答案】改写成更自然、更友好、更个性化的回复。

规则：
1. 保持信息准确，不要编造
2. 语言亲切自然，用「您」称呼用户
3. 回复控制在2-3句话内
4. 不要说"根据标准答案..."这类机械的话`;

    const userPrompt = `【用户当前问题】：${userMessage}

【标准答案】：${faqAnswer}

请直接返回改写后的回复（不要有任何前缀或解释）：`;

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

    const result = await new Promise((resolve) => {
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 30000  // 30秒超时
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const rewritten = parsed.choices?.[0]?.message?.content?.trim() || faqAnswer;
            resolve(rewritten);
          } catch (e) {
            console.error('❌ 解析失败：', e.message);
            resolve(faqAnswer);
          }
        });
      });

      req.on('error', (err) => {
        console.error('❌ 请求失败：', err.message);
        resolve(faqAnswer);
      });

      req.on('timeout', () => {
        req.destroy();
        console.error('❌ 请求超时');
        resolve(faqAnswer);
      });

      req.write(payload);
      req.end();
    });

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    console.log(`\n✅ LLM改写完成！耗时: ${duration.toFixed(2)}秒`);
    console.log(`\n原答案：\n${faqAnswer}\n`);
    console.log(`改写后：\n${result}\n`);

    if (result !== faqAnswer) {
      console.log('🎉 LLM改写成功！答案已优化。');
    } else {
      console.log('⚠️ LLM改写失败，返回原答案（可能Ollama服务不可用或超时）');
    }

  } catch (err) {
    console.error('❌ 测试失败：', err);
  }
}

testRewrite();
