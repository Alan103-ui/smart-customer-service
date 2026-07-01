/**
 * RAG完整评估脚本 - 通过WebSocket测试
 * 基于FAQ数据，测试检索质量
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3001/ws';
const FAQ_PATH = path.join(__dirname, '../data/faq.json');
const CONVERSATIONS_PATH = path.join(__dirname, '../data/conversations.json');

// 读取FAQ数据
function loadFAQ() {
  return JSON.parse(fs.readFileSync(FAQ_PATH, 'utf8'));
}

// 读取对话数据（用于获取sessionId）
function getSessionId() {
  if (!fs.existsSync(CONVERSATIONS_PATH)) {
    return null;
  }
  const conversations = JSON.parse(fs.readFileSync(CONVERSATIONS_PATH, 'utf8'));
  if (conversations.length > 0) {
    return conversations[0].session_id;
  }
  return null;
}

// 通过WebSocket发送消息并等待响应
function sendMessageAndWait(ws, message, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('等待响应超时'));
    }, timeout);

    const onMessage = (data) => {
      try {
        const response = JSON.parse(data);
        
        // 我们关心这些类型的消息
        if (response.type === 'intent' || 
            response.type === 'candidates' || 
            response.type === 'message' ||
            response.type === 'typing') {
          
          clearTimeout(timer);
          ws.removeListener('message', onMessage);
          resolve(response);
        }
      } catch (e) {
        // 忽略非JSON消息
      }
    };

    ws.on('message', onMessage);
    
    // 发送消息
    ws.send(JSON.stringify({
      type: 'message',
      content: message,
      timestamp: new Date().toISOString()
    }));
  });
}

// 测试单个FAQ
async function testSingleFAQ(ws, faq, idx) {
  console.log(`\n[${idx + 1}] 测试: "${faq.question}"`);
  console.log(`    预期FAQ ID: ${faq.id}`);
  
  try {
    const response = await sendMessageAndWait(ws, faq.question);
    
    console.log(`    响应类型: ${response.type}`);
    
    if (response.type === 'candidates') {
      // 有候选列表
      const candidates = response.candidates || [];
      console.log(`    候选数量: ${candidates.length}`);
      
      if (candidates.length > 0) {
        const topCandidate = candidates[0];
        const found = topCandidate.id === faq.id;
        console.log(`    Top候选: ${topCandidate.question}`);
        console.log(`    置信度: ${topCandidate.confidence}`);
        console.log(`    是否匹配: ${found ? '✅' : '❌'}`);
        
        return {
          query: faq.question,
          expectedId: faq.id,
          found,
          candidateCount: candidates.length,
          topConfidence: topCandidate.confidence,
          topQuestion: topCandidate.question
        };
      }
    } else if (response.type === 'message') {
      // 直接返回答案（高置信度）
      const found = response.matchedQuestion === faq.question;
      console.log(`    直接返回答案: ${response.content.substring(0, 50)}...`);
      console.log(`    匹配问题: ${response.matchedQuestion || '无'}`);
      console.log(`    是否匹配: ${found ? '✅' : '❌'}`);
      
      return {
        query: faq.question,
        expectedId: faq.id,
        found,
        directAnswer: true,
        confidence: response.confidence,
        matchedQuestion: response.matchedQuestion
      };
    } else if (response.type === 'intent') {
      console.log(`    意图: ${response.intent}, 置信度: ${response.confidence}`);
      
      return {
        query: faq.question,
        expectedId: faq.id,
        found: false,
        intentOnly: true,
        intent: response.intent,
        confidence: response.confidence
      };
    }
    
    return {
      query: faq.question,
      expectedId: faq.id,
      found: false,
      error: '未知响应类型'
    };
    
  } catch (error) {
    console.log(`    ❌ 错误: ${error.message}`);
    return {
      query: faq.question,
      expectedId: faq.id,
      found: false,
      error: error.message
    };
  }
}

// 主函数
async function main() {
  console.log('开始RAG完整评估...');
  console.log('='.repeat(60));
  
  const faqs = loadFAQ();
  console.log(`加载了 ${faqs.length} 条FAQ`);
  
  const results = [];
  
  // 创建WebSocket连接
  const ws = new WebSocket(WS_URL);
  
  ws.on('open', async () => {
    console.log('WebSocket连接成功');
    console.log('='.repeat(60));
    
    // 测试每个FAQ
    for (let i = 0; i < faqs.length; i++) {
      const result = await testSingleFAQ(ws, faqs[i], i);
      results.push(result);
      
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // 计算指标
    const total = results.length;
    const foundCount = results.filter(r => r.found).length;
    const errorCount = results.filter(r => r.error).length;
    const directAnswerCount = results.filter(r => r.directAnswer).length;
    const intentOnlyCount = results.filter(r => r.intentOnly).length;
    
    const summary = {
      timestamp: new Date().toISOString(),
      total,
      foundCount,
      foundRate: (foundCount / total * 100).toFixed(2) + '%',
      directAnswerCount,
      intentOnlyCount,
      errorCount,
      details: results
    };
    
    // 保存结果
    const reportPath = path.join(
      __dirname,
      `../data/rag-eval-websocket-${Date.now()}.json`
    );
    fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));
    
    // 保存为最新报告
    const latestPath = path.join(__dirname, '../data/rag-eval-latest.json');
    fs.writeFileSync(latestPath, JSON.stringify(summary, null, 2));
    
    // 打印摘要
    console.log('\n' + '='.repeat(60));
    console.log('评估完成！');
    console.log('='.repeat(60));
    console.log(`总查询数: ${total}`);
    console.log(`检索成功: ${summary.foundRate} (${foundCount}/${total})`);
    console.log(`直接回答: ${directAnswerCount}`);
    console.log(`仅意图: ${intentOnlyCount}`);
    console.log(`错误数: ${errorCount}`);
    console.log('='.repeat(60));
    console.log(`报告已保存: ${reportPath}`);
    
    // 找出检索失败的问题
    console.log('\n检索失败的问题:');
    results.forEach((r, idx) => {
      if (!r.found) {
        console.log(`  ${idx + 1}. ${r.query}`);
        if (r.topQuestion) {
          console.log(`     实际检索到: ${r.topQuestion}`);
        }
        if (r.error) {
          console.log(`     错误: ${r.error}`);
        }
      }
    });
    
    ws.close();
    process.exit(0);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket错误:', error);
    process.exit(1);
  });
}

// 执行
main().catch(console.error);
