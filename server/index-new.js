/**
 * 广康集团AI助手 - 后端主文件（优化版）
 * 优化点：
 * 1. 降低置信度阈值（0.7→0.6），让更多问题直接匹配FAQ
 * 2. 删除detectIntent中的FAQ匹配逻辑，完全依赖RAG
 * 3. 高置信度时直接返回FAQ答案，不调LLM
 * 4. 无匹配时直接转人工，不调LLM
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const uuidv4 = () => require('crypto').randomUUID();

// 导入模块
const { getFAQ, saveFAQ, getFAQCategories, addFAQ, updateFAQ, deleteFAQ } = require('./faq-manager');
const { searchByFAQCacheAsync, buildFAQEmbeddingCache, semanticSearch } = require('./vector-store');
const { detectIntent } = require('./intent-detector');
const { generateAgentReply } = require('./reply-generator');
const { readDB, writeDB, saveMessage, getOrCreateConversation } = require('./db-helper');

// ============ 配置 ============
const PORT = 3001;
const OLLAMA_HOST = '172.17.6.18';
const OLLAMA_PORT = 11434;
const OLLAMA_API = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;

// ============ Express 应用 ============
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// ============ WebSocket 服务 ============
function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws' });
  
  wss.on('connection', (ws) => {
    let sessionId = null;
    
    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data);
          
        if (msg.type === 'init') {
          sessionId = msg.sessionId || uuidv4();
          const category = msg.category || null;
          sessions.set(sessionId, { ws, history: [], category });
          ws.send(JSON.stringify({ type: 'init', sessionId }));
            
          const conv = getOrCreateConversation(sessionId);
          const messages = typeof conv.messages === 'string' ? JSON.parse(conv.messages) : conv.messages;
          if (messages.length > 0) {
            ws.send(JSON.stringify({ type: 'history', messages }));
          }
          return;
        }
          
        if (msg.type === 'message' && sessionId) {
          const userMessage = msg.content;
          const category = (() => { const s = sessions.get(sessionId); return s ? s.category : null; })();
          saveMessage(sessionId, 'user', userMessage);
            
          // 语义搜索候选 FAQ（本地快速匹配 → FAQ缓存搜索 → Rerank重排序）
          console.log(`[WS] 收到消息: "${userMessage}", 开始语义搜索...`);
          const candidates = await searchFAQCandidates(userMessage, 0.12, category);
          console.log(`[WS] 语义搜索完成, 候选问题数量: ${candidates.length}`);
            
          if (candidates.length > 0) {
            // 高置信度（≥0.6）：直接返回最佳答案，不等待用户点击，不调LLM
            if (candidates[0].confidence >= 0.6) {
              const best = candidates[0];
              const reply = best.faq.answer;
              saveMessage(sessionId, 'assistant', reply, best.intent);
              ws.send(JSON.stringify({
                type: 'message',
                content: reply,
                timestamp: new Date().toISOString(),
                intent: best.intent,
                confidence: best.confidence,
                fallback: false,
                matchedQuestion: best.faq.question
              }));
              console.log(`[WS] 高置信度直接返回: "${userMessage}" → "${best.faq.question}" (confidence: ${best.confidence.toFixed(2)})`);
              return;
            }
              
            // 低置信度：发送候选列表让用户选择
            ws.send(JSON.stringify({
              type: 'intent',
              intent: 'faq_candidate',
              confidence: candidates[0].confidence,
            }));
              
            const candidateList = candidates.map(c => ({
              id: c.faq.id,
              question: c.faq.question,
              answer: c.faq.answer,
              confidence: Math.round(c.confidence * 100) / 100
            }));
              
            ws.send(JSON.stringify({
              type: 'candidates',
              candidates: candidateList,
              originalMessage: userMessage
            }));
            return;
          }
            
          // 没有匹配到FAQ，直接转人工（不调用LLM，避免慢响应）
          console.log(`[WS] 无匹配，转人工: "${userMessage}"`);
          const reply = '抱歉，我暂时无法回答您的问题。正在为您转接人工客服，请稍候...（工作时间：9:00-21:00）';
          saveMessage(sessionId, 'assistant', reply, 'unknown');
          ws.send(JSON.stringify({
            type: 'message', content: reply,
            timestamp: new Date().toISOString(),
            fallback: true
          }));
          return;
        }
          
        if (msg.type === 'candidate_select' && sessionId) {
          const { candidateId } = msg;
          const faqList = getFAQ();
          const faq = faqList.find(f => f.id === candidateId);
          if (faq) {
            saveMessage(sessionId, 'assistant', faq.answer, faq.intent);
            ws.send(JSON.stringify({
              type: 'message', content: faq.answer,
              timestamp: new Date().toISOString(),
              intent: faq.intent, confidence: 1.0, fallback: true
            }));
          }
          return;
        }
          
        if (msg.type === 'satisfaction') {
          const { rating, comment } = msg;
          const db = readDB();
          db.satisfaction.push({
            id: uuidv4(), session_id: sessionId, rating, comment,
            created_at: new Date().toISOString()
          });
          writeDB(db);
          ws.send(JSON.stringify({ type: 'satisfaction_ack' }));
          return;
        }
      } catch (e) {
        console.error('[WS] 消息处理失败:', e);
      }
    });
      
    ws.on('close', () => {
      if (sessionId) sessions.delete(sessionId);
    });
  });
  
  return wss;
}

// ============ 启动服务 ============
const server = http.createServer(app);
const wss = setupWebSocket(server);

server.listen(PORT, '0.0.0.0', async () => {
  console.log(`🤖 广康集团AI助手后端服务启动成功！`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   管理后台 API: http://localhost:${PORT}/api/admin/stats`);
  console.log(`   AI 模型: qwen2.5:14b @ ${OLLAMA_API}/v1/chat/completions`);
  console.log(`   数据文件: ${path.join(__dirname, '../data/conversations.json')}`);
    
  try {
    const count = buildFAQEmbeddingCache();
    console.log(`   FAQ 缓存: ${count} 条（内存加速搜索）`);
  } catch (e) {
    console.warn(`   FAQ 缓存构建失败: ${e.message}`);
  }
});

module.exports = { app, server, wss };
