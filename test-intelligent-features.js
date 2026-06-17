// 测试智能功能：多轮对话记忆、LLM智能改写、意图理解
const WebSocket = require('ws');
const http = require('http');

const WS_URL = 'ws://localhost:3001/ws';
const API_URL = 'http://localhost:3001';

// 测试用例
const testCases = [
  {
    name: '测试1: 超高置信度（≥0.8）',
    message: '一类城市',
    expectDirectReturn: true,  // 应该直接返回，不调LLM
    expectLLMRewrite: false
  },
  {
    name: '测试2: 高置信度（0.6-0.8）- 应该调用LLM改写',
    message: '城市分类标准',
    expectDirectReturn: false,  // 应该调用LLM改写
    expectLLMRewrite: true
  },
  {
    name: '测试3: 多轮对话 - 指代理解',
    messages: ['一类城市', '它的费用是多少？'],  // 第二轮应该理解"它"指"一类城市"
    expectContextUnderstanding: true
  },
  {
    name: '测试4: 意图理解 - 投诉语气',
    message: '你们的服务太差了！我要投诉！',
    expectIntentDetection: true
  }
];

// 测试WebSocket连接和消息
function testWebSocket(testCase) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let sessionId = null;
    let step = 0;
    const results = [];
    
    ws.on('open', () => {
      console.log(`\n【${testCase.name}】`);
      console.log('✅ WebSocket连接成功');
      
      // 发送init消息
      ws.send(JSON.stringify({
        type: 'init',
        userId: 'test_user_' + Date.now(),
        userName: '测试用户'
      }));
    });
    
    ws.on('message', (data) => {
      const msg = JSON.parse(data);
      
      if (msg.type === 'init') {  // 修复：后端发送的是type: 'init'，不是'init_ack'
        sessionId = msg.sessionId;
        console.log(`✅ 会话初始化成功: ${sessionId}`);
        
        // 发送测试消息
        const messages = testCase.messages || [testCase.message];
        sendMessage(ws, messages[0]);
      }
      
      if (msg.type === 'intent') {
        console.log(`  [候选通知] 置信度: ${msg.confidence}`);
        // 候选列表会在后续的'type: candidates'消息中发送
      }
      
      if (msg.type === 'candidates') {
        console.log(`  [候选列表] 收到 ${msg.candidates.length} 个候选`);
        console.log(`     候选1: ${msg.candidates[0].question} (置信度: ${msg.candidates[0].confidence})`);
        
        // 自动选择第一个候选
        console.log(`  [候选列表] 自动选择第一个候选...`);
        ws.send(JSON.stringify({
          type: 'candidate_select',
          candidateId: msg.candidates[0].id
        }));
      }
      
      if (msg.type === 'typing') {
        console.log(`  [${msg.status ? '开始' : '结束'}输入提示]`);
      }
      
      if (msg.type === 'message' && msg.fallback) {
        console.log(`\n✅ 收到转人工回复:`);
        console.log(`   内容: ${msg.content.substring(0, 100)}...`);
        
        if (testCase.expectIntentDetection) {
          console.log(`\n🎉 测试成功！AI识别了投诉意图，已转人工！`);
        }
        
        ws.close();
        resolve(true);
      }
      
      if (msg.type === 'message') {
        console.log(`✅ 收到AI回复:`);
        console.log(`   内容: ${msg.content.substring(0, 100)}...`);
        console.log(`   置信度: ${msg.confidence || 'N/A'}`);
        console.log(`   是否改写: ${msg.rewritten || false}`);
        console.log(`   匹配问题: ${msg.matchedQuestion || 'N/A'}`);
        
        results.push({
          content: msg.content,
          confidence: msg.confidence,
          rewritten: msg.rewritten,
          matchedQuestion: msg.matchedQuestion
        });
        
        // 如果是多轮对话测试，发送第二条消息
        if (testCase.messages && step < testCase.messages.length - 1) {
          step++;
          setTimeout(() => {
            sendMessage(ws, testCase.messages[step]);
          }, 2000);
        } else {
          ws.close();
          resolve(results);
        }
      }
    });
    
    ws.on('error', (err) => {
      console.error(`❌ WebSocket错误: ${err.message}`);
      resolve(null);
    });
    
    ws.on('close', () => {
      console.log(`✅ WebSocket连接关闭`);
      resolve(results);
    });
    
    // 超时处理
    setTimeout(() => {
      console.log(`⚠️ 测试超时（60秒）`);
      ws.close();
      resolve(results);
    }, 60000);  // 增加到60秒超时
  });
}

function sendMessage(ws, content) {
  console.log(`📤 发送消息: "${content}"`);
  ws.send(JSON.stringify({
    type: 'message',
    content: content
  }));
}

// 主测试函数
async function runTests() {
  console.log('🚀 开始测试智能功能...\n');
  console.log('='.repeat(60));
  
  for (const testCase of testCases) {
    const results = await testWebSocket(testCase);
    
    // 验证结果
    if (results && results.length > 0) {
      console.log(`\n📊 测试结果验证:`);
      
      if (testCase.expectDirectReturn) {
        const isDirect = !results[0].rewritten;
        console.log(`  ${isDirect ? '✅' : '❌'} 超高置信度直接返回: ${isDirect}`);
      }
      
      if (testCase.expectLLMRewrite) {
        const isRewritten = results[0].rewritten;
        console.log(`  ${isRewritten ? '✅' : '❌'} LLM改写答案: ${isRewritten}`);
      }
      
      if (testCase.expectContextUnderstanding) {
        // 检查第二条回复是否理解了上下文
        const secondReply = results[1]?.content || '';
        const understandsContext = secondReply.includes('一类') || secondReply.includes('城市');
        console.log(`  ${understandsContext ? '✅' : '❌'} 多轮对话理解: ${understandsContext}`);
        console.log(`    第二条回复: ${secondReply.substring(0, 80)}...`);
      }
    }
    
    console.log('='.repeat(60));
    
    // 等待2秒再测试下一个
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n🎉 所有测试完成！');
}

// 检查依赖
try {
  require('ws');
  runTests().catch(console.error);
} catch (err) {
  console.log('⚠️ 需要安装ws模块: npm install ws');
  console.log('正在安装...');
  require('child_process').execSync('npm install ws', { cwd: __dirname, stdio: 'inherit' });
  runTests().catch(console.error);
}
