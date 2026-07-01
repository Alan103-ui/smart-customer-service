/**
 * 性能监控页面生成器
 * 用于生成管理后台风格的性能监控页面
 */

function generatePerformancePage(token) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>性能监控 - 广康AI智能客服系统</title>
  <style>
    * { margin:0; padding:0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
      background: #f0f2f5;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header h1 { font-size: 24px; font-weight: 600; }
    .header .back-btn {
      background: rgba(255,255,255,0.2);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      font-size: 14px;
      transition: all 0.3s;
    }
    .header .back-btn:hover { background: rgba(255,255,255,0.3); }
    .container {
      max-width: 1400px;
      margin: 30px auto;
      padding: 0 20px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .stat-card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      transition: all 0.3s;
    }
    .stat-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 2px solid #f0f0f0;
    }
    .card-icon {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }
    .icon-embedding { background: linear-gradient(135deg, #667eea, #764ba2); }
    .icon-llm { background: linear-gradient(135deg, #f093fb, #f5576c); }
    .icon-reranker { background: linear-gradient(135deg, #4facfe, #00f2fe); }
    .card-title { font-size: 18px; font-weight: 600; color: #333; }
    .card-badge {
      margin-left: auto;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .badge-ok { background: #f6ffed; color: #52c41a; border: 1px solid #b7eb8f; }
    .badge-error { background: #fff2f0; color: #ff4d4f; border: 1px solid #ffccc7; }
    .metric-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px solid #f5f5f5;
    }
    .metric-row:last-child { border-bottom: none; }
    .metric-label { font-size: 14px; color: #666; }
    .metric-value { font-size: 14px; color: #333; font-weight: 600; }
    .charts-section {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }
    .chart-card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.08);
    }
    .chart-title { font-size: 18px; font-weight: 600; color: #333; margin-bottom: 20px; }
    .bar-chart { display: flex; flex-direction: column; gap: 12px; }
    .bar-item { display: flex; align-items: center; gap: 12px; }
    .bar-label { width: 100px; font-size: 14px; color: #666; text-align: right; }
    .bar-track {
      flex: 1;
      height: 24px;
      background: #f5f5f5;
      border-radius: 12px;
      overflow: hidden;
      position: relative;
    }
    .bar-fill {
      height: 100%;
      border-radius: 12px;
      transition: width 0.8s ease-out;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 8px;
      font-size: 12px;
      color: white;
      font-weight: 600;
    }
    .fill-time { background: linear-gradient(90deg, #667eea, #764ba2); }
    .fill-success-ok { background: linear-gradient(90deg, #52c41a, #73d13d); }
    .fill-success-bad { background: linear-gradient(90deg, #ff4d4f, #ff7875); }
    .bar-value { width: 80px; font-size: 14px; color: #333; font-weight: 600; }
    .refresh-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .refresh-timer { font-size: 14px; color: #999; }
    .refresh-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 10px 24px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.3s;
    }
    .refresh-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 12px rgba(102,126,234,0.4);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 模型性能监控</h1>
    <a href="/" class="back-btn">← 返回管理后台</a>
  </div>
  
  <div class="container">
    <div class="refresh-section">
      <div class="refresh-timer">自动刷新: <span id="countdown">30</span>s</div>
      <button class="refresh-btn" onclick="loadData()">🔄 立即刷新</button>
    </div>
    
    <div class="stats-grid" id="statsGrid"></div>
    
    <div class="charts-section">
      <div class="chart-card">
        <div class="chart-title">📈 响应时间对比（ms）</div>
        <div class="bar-chart" id="responseTimeChart"></div>
      </div>
      
      <div class="chart-card">
        <div class="chart-title">✅ 成功率对比（%）</div>
        <div class="bar-chart" id="successRateChart"></div>
      </div>
    </div>
  </div>
  
  <script>
    const token = 'TOKEN_PLACEHOLDER';
    let countdown = 30;
    let timer = null;
    
    async function loadData() {
      try {
        const res = await fetch('/api/admin/models/performance', {
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        
        if (data.success) {
          updateUI(data.report);
        }
      } catch (e) {
        console.error('加载数据失败:', e);
      }
    }
    
    function updateUI(report) {
      const grid = document.getElementById('statsGrid');
      grid.innerHTML = '';
      
      const models = [
        { key: 'embedding', label: '嵌入模型', icon: '🤖', iconClass: 'icon-embedding' },
        { key: 'llm', label: '生成模型', icon: '💬', iconClass: 'icon-llm' },
        { key: 'reranker', label: '重排序模型', icon: '🔍', iconClass: 'icon-reranker' }
      ];
      
      models.forEach(m => {
        const d = report[m.key];
        const badgeClass = d.healthStatus.includes('✅') ? 'badge-ok' : 'badge-error';
        
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = '
          <div class="card-header">
            <div class="card-icon ' + m.iconClass + '">' + m.icon + '</div>
            <div class="card-title">' + m.label + '性能</div>
            <div class="card-badge ' + badgeClass + '">' + d.healthStatus + '</div>
          </div>
          <div class="metric-row"><span class="metric-label">当前模型</span><span class="metric-value">' + (d.currentModel || '-') + '</span></div>
          <div class="metric-row"><span class="metric-label">总请求数</span><span class="metric-value">' + d.totalRequests + '</span></div>
          <div class="metric-row"><span class="metric-label">成功率</span><span class="metric-value">' + d.successRate + '</span></div>
          <div class="metric-row"><span class="metric-label">平均响应</span><span class="metric-value">' + d.avgResponseTime + '</span></div>
          <div class="metric-row"><span class="metric-label">最小响应</span><span class="metric-value">' + d.minResponseTime + '</span></div>
          <div class="metric-row"><span class="metric-label">最大响应</span><span class="metric-value">' + d.maxResponseTime + '</span></div>
          <div class="metric-row"><span class="metric-label">最后响应</span><span class="metric-value">' + d.lastResponseTime + '</span></div>
          <div class="metric-row"><span class="metric-label">每分钟请求</span><span class="metric-value">' + d.requestsPerMinute + '</span></div>
        ';
        grid.appendChild(card);
      });
      
      updateCharts(report);
    }
    
    function updateCharts(report) {
      // 响应时间图表
      const timeData = [
        { label: '嵌入模型', value: parseInt(report.embedding.avgResponseTime) || 0 },
        { label: '生成模型', value: parseInt(report.llm.avgResponseTime) || 0 },
        { label: '重排序', value: parseInt(report.reranker.avgResponseTime) || 0 }
      ];
      renderBarChart('responseTimeChart', timeData, 'ms', 'fill-time');
      
      // 成功率图表
      const successData = [
        { label: '嵌入模型', value: parseFloat(report.embedding.successRate) || 0 },
        { label: '生成模型', value: parseFloat(report.llm.successRate) || 0 },
        { label: '重排序', value: parseFloat(report.reranker.successRate) || 0 }
      ];
      renderBarChart('successRateChart', successData, '%', 'fill-success-ok');
    }
    
    function renderBarChart(containerId, data, unit, fillClass) {
      const container = document.getElementById(containerId);
      const maxVal = Math.max(...data.map(d => d.value), 1);
      
      container.innerHTML = data.map(d => {
        const pct = (d.value / maxVal * 100).toFixed(1);
        return '
          <div class="bar-item">
            <div class="bar-label">' + d.label + '</div>
            <div class="bar-track">
              <div class="bar-fill ' + fillClass + '" style="width: ' + pct + '%">
                ' + d.value + unit + '
              </div>
            </div>
          </div>
        ';
      }).join('');
    }
    
    function startCountdown() {
      countdown = 30;
      document.getElementById('countdown').textContent = countdown;
      
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        countdown--;
        document.getElementById('countdown').textContent = countdown;
        if (countdown <= 0) {
          loadData();
          startCountdown();
        }
      }, 1000);
    }
    
    // 初始化
    loadData();
    startCountdown();
  </script>
</body>
</html>`;
  
  // 替换token占位符
  return html.replace('TOKEN_PLACEHOLDER', token);
}

module.exports = { generatePerformancePage };
