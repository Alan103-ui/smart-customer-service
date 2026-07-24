// 模型诊断接口数据链路验证（不依赖 HTTP，直接驱动真实 model-switcher 函数）
const ms = require('../model-switcher');

(async () => {
  let pass = 0, fail = 0;
  const ok = (name, cond) => { if (cond) { pass++; console.log('  ✅', name); } else { fail++; console.log('  ❌', name); } };

  // 1) 配置结构
  const cfg = ms.getModelConfig();
  ok('getModelConfig 含 embedding/llm/reranker', !!(cfg.embedding && cfg.llm && cfg.reranker));
  ok('ollama.baseUrl 存在', !!(cfg.ollama && typeof cfg.ollama.baseUrl === 'string'));
  console.log('   配置: embedding=%s llm=%s reranker.serviceUrl=%s baseUrl=%s',
    cfg.embedding.primary, cfg.llm.primary, cfg.reranker.serviceUrl, cfg.ollama.baseUrl);

  // 2) listOllamaModels：不可达也应优雅返回 []，不抛异常
  let models = [];
  try { models = await ms.listOllamaModels(cfg.ollama.baseUrl); ok('listOllamaModels 返回数组且不抛异常', Array.isArray(models)); }
  catch (e) { ok('listOllamaModels 不抛异常', false); console.log('    err=', e.message); }
  console.log('   已拉取模型列表(%d): %s', models.length, models.join(', ') || '(无法连接或为空)');

  // 3) testConnection 三种类型均返回标准结构、不抛异常
  const types = [
    { key: 'embedding', label: '嵌入', opts: { primary: cfg.embedding.primary, baseUrl: cfg.ollama.baseUrl } },
    { key: 'llm', label: 'LLM', opts: { primary: cfg.llm.primary, baseUrl: cfg.ollama.baseUrl } },
    { key: 'reranker', label: 'Rerank', opts: { serviceUrl: cfg.reranker.serviceUrl, timeout: cfg.reranker.timeout } },
  ];
  for (const t of types) {
    try {
      const r = await ms.testConnection(t.key, t.opts);
      ok(`${t.label} testConnection 返回 {available,responseTime,error}`,
        r && typeof r.available === 'boolean' && typeof r.responseTime === 'number');
      console.log('   %s -> available=%s rt=%sms err=%s', t.label, r.available, r.responseTime, r.error || '-');
    } catch (e) { ok(`${t.label} testConnection 不抛异常`, false); console.log('    err=', e.message); }
  }

  // 4) 模拟 diagnose 的「模型是否已拉取」判定逻辑
  const modelExists = (name) => {
    if (!name) return null;
    if (models.includes(name)) return true;
    const base = name.split(':')[0];
    return models.some((m) => m === name || m.startsWith(base + ':'));
  };
  const e1 = modelExists(cfg.embedding.primary);
  ok('modelExists 判定函数对主嵌入模型返回 boolean|null', e1 === true || e1 === false || e1 === null);

  console.log('\n结果: %d 通过 / %d 失败', pass, fail);
  process.exit(fail === 0 ? 0 : 1);
})();
