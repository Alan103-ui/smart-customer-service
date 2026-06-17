var WebSocket = require('ws');

var WS_URL = 'ws://localhost:3001';
var TEST_MESSAGES = ['一级城市', '借款', '费用报销', '营业执照怎么办理'];

function testChat(message) {
  return new Promise(function(resolve, reject) {
    var ws = new WebSocket(WS_URL);
    var sessionId = 'test_session_' + Date.now();
    var step = 0;
    var start = Date.now();

    var timeout = setTimeout(function() {
      ws.close();
      reject(new Error('Timeout'));
    }, 10000);

    ws.on('open', function() {
      console.log('\n[' + message + '] WebSocket连接成功');
      ws.send(JSON.stringify({
        type: 'chat_message',
        sessionId: sessionId,
        message: message,
        userId: 'test_user',
        username: '测试用户',
        category: '全部'
      }));
    });

    ws.on('message', function(data) {
      try {
        var msg = JSON.parse(data.toString());
        
        if (msg.type === 'candidates_found' && step === 0) {
          step = 1;
          var cost = Date.now() - start;
          var count = (msg.candidates && msg.candidates.length) ? msg.candidates.length : 0;
          console.log('  候选问题返回: ' + count + '条, 耗时: ' + cost + 'ms');
          if (msg.candidates && msg.candidates.length > 0) {
            for (var i = 0; i < Math.min(3, msg.candidates.length); i++) {
              var c = msg.candidates[i];
              var q = c.faq ? c.faq.question : 'N/A';
              var conf = c.confidence ? c.confidence.toFixed(2) : 'N/A';
              console.log('    [#' + (i+1) + '] ' + q + ' (confidence: ' + conf + ')');
            }
          }
        }

        if (msg.type === 'agent_reply' && step === 1) {
          step = 2;
          var cost2 = Date.now() - start;
          clearTimeout(timeout);
          console.log('  AI回复完成: 耗时: ' + cost2 + 'ms');
          var reply = msg.reply ? msg.reply.substring(0, 80) : '';
          console.log('  回复内容: ' + reply + '...');
          ws.close();
          resolve(cost2);
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.on('error', function(err) {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function runTests() {
  console.log('=== 测试聊天回复速度 ===');
  console.log('测试消息: ' + TEST_MESSAGES.join(', '));

  for (var i = 0; i < TEST_MESSAGES.length; i++) {
    var msg = TEST_MESSAGES[i];
    try {
      var cost = await testChat(msg);
      console.log('[' + msg + '] 总耗时: ' + cost + 'ms');
    } catch (e) {
      console.error('[' + msg + '] 测试失败: ' + e.message);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n=== 测试完成 ===');
  process.exit(0);
}

runTests();
