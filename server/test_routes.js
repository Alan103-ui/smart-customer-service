// 路由健康检查脚本
const http = require('http');

const BASE_URL = 'http://localhost:3001';
const routes = [
  // GET 路由
  { method: 'GET', path: '/api/admin/stats', description: '管理后台统计' },
  { method: 'GET', path: '/api/admin/categories', description: '分类列表' },
  { method: 'GET', path: '/api/categories', description: '一级分类列表' },
  { method: 'GET', path: '/api/admin/faq', description: 'FAQ 列表' },
  { method: 'GET', path: '/api/admin/knowledge-bases', description: '知识库列表' },
  { method: 'GET', path: '/api/admin/vector-stats', description: '向量库统计' },
  { method: 'GET', path: '/api/admin/conversations', description: '对话记录' },
  { method: 'GET', path: '/api/admin/intent-taxonomy', description: '意图分类体系' },
  { method: 'GET', path: '/api/admin/rewrite-tones', description: '语气列表' },
  { method: 'GET', path: '/api/admin/uploads', description: '上传文件列表' },
  { method: 'GET', path: '/api/admin/org', description: '组织架构' },
  { method: 'GET', path: '/api/admin/personnel', description: '人员信息' },
  { method: 'GET', path: '/api/admin/permissions', description: '权限管理' },
  { method: 'GET', path: '/api/admin/a8-config', description: 'A8配置' },
  
  // WebSocket（需要特殊处理）
  { method: 'WS', path: '/ws', description: 'WebSocket 连接' }
];

console.log('='.repeat(60));
console.log('路由健康检查开始...');
console.log('='.repeat(60));
console.log('');

let passed = 0;
let failed = 0;
const results = [];

// 测试 GET 路由
const testRoute = (route) => {
  return new Promise((resolve) => {
    const url = `${BASE_URL}${route.path}`;
    
    const req = http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const status = res.statusCode;
        const isOK = status >= 200 && status < 300;
        
        if (isOK) {
          passed++;
          console.log(`✅ ${route.method} ${route.path}`);
          console.log(`   状态: ${status} - ${route.description}`);
        } else {
          failed++;
          console.log(`❌ ${route.method} ${route.path}`);
          console.log(`   状态: ${status} - ${route.description}`);
          console.log(`   错误: ${data.substring(0, 100)}`);
        }
        console.log('');
        
        results.push({
          method: route.method,
          path: route.path,
          description: route.description,
          status,
          passed: isOK
        });
        
        resolve();
      });
    });
    
    req.on('error', (e) => {
      failed++;
      console.log(`❌ ${route.method} ${route.path}`);
      console.log(`   错误: ${e.message}`);
      console.log('');
      
      results.push({
        method: route.method,
        path: route.path,
        description: route.description,
        status: 0,
        passed: false,
        error: e.message
      });
      
      resolve();
    });
    
    req.setTimeout(5000, () => {
      req.destroy();
      failed++;
      console.log(`❌ ${route.method} ${route.path}`);
      console.log(`   错误: 请求超时`);
      console.log('');
      
      results.push({
        method: route.method,
        path: route.path,
        description: route.description,
        status: 0,
        passed: false,
        error: '请求超时'
      });
      
      resolve();
    });
  });
};

// 顺序测试所有路由
(async () => {
  for (const route of routes) {
    if (route.method === 'GET') {
      await testRoute(route);
    }
  }
  
  console.log('='.repeat(60));
  console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
  console.log('='.repeat(60));
  console.log('');
  
  // 输出总结
  console.log('详细结果:');
  console.log('');
  results.forEach(r => {
    const status = r.passed ? '✅' : '❌';
    console.log(`${status} ${r.method} ${r.path} - ${r.description}`);
    if (!r.passed && r.error) {
      console.log(`   错误: ${r.error}`);
    }
  });
  
  console.log('');
  console.log('='.repeat(60));
  if (failed === 0) {
    console.log('🎉 所有路由正常工作！');
  } else {
    console.log(`⚠️  有 ${failed} 个路由存在问题，请检查 above.`);
  }
  console.log('='.repeat(60));
})();
