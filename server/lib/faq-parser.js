/**
 * FAQ 文档混合解析器（可复用核心模块，领域自适应版）
 * ------------------------------------------------------------
 * 设计目标：把制度/规则/FAQ 类文档（txt/md/pdf/docx/xlsx 抽取出的纯文本）
 * 稳定地转换为结构化问答对：{ question, answer, keywords }。
 *
 * 架构核心（克制且可靠）：
 *   1) prefilterText        —— 正则预清洗，剔除表格边框/分隔/勾选噪声行
 *   2) parseDocToFAQ         —— 确定性正则抽取（完整性基石，绝不丢条）
 *   3) parseDocToFAQWithLLM  —— LLM 批量润色问句 + 关键词（质量增强，失败回退正则）
 *
 * 领域自适应（v1.2）：
 *   - DEFAULT_TERMS 默认词表已覆盖 财务/HR/IT/法务/通用制度 + 制造业全业务板块
 *   - 细分行业 preset（可选，默认不加载）：gmp / iatf16949 / haccp / iso13485 / as9100
 *       用法：opts.preset = 'gmp' | ['iatf16949','haccp'] | 'auto'(按签名词自动识别)
 *   - 也可直接注入领域词表 / 表格识别词，做到换资料即插即用：
 *       parseDocToFAQ(text, cat, { terms:[...], approveKw:[...], preset:'gmp' })
 *       parseDocToFAQWithLLM(text, cat, llmFn, { preset:'auto' })
 *   - 不传 opts 时全部走默认值，任何中文资料都能直接用
 *
 * 关键经验（来自真实踩坑）：
 *   - 纯 LLM 抽取在短文档上召回极不稳定（同一文档 1~9 条波动），故正则为基石。
 *   - 绝不让 LLM「drop」条目：曾因 drop 误删真实定义，改为「只增不减」合并。
 *   - 预清洗必须带「句子保护」：任何含句末标点/中文句子标志词的真实规则一律放行。
 *
 * 用法：
 *   const parser = require('./faq-parser');
 *   const faqs = parser.parseDocToFAQ(text, '财务');                       // 纯正则
 *   const faqs2 = await parser.parseDocToFAQWithLLM(text, 'HR', llmFn);    // 带 LLM 润色
 *   // 细分行业：医药 GMP 文档指定 preset（auto 可自动识别）
 *   const gmpFaqs = await parser.parseDocToFAQWithLLM(text, '药品', llmFn, { preset: 'gmp' });
 *   const autoFaqs = await parser.parseDocToFAQWithLLM(text, '其他', llmFn, { preset: 'auto' });
 */

// ============================================================
// 默认领域词表（覆盖常见五大域，用于自动提取关键词）
// 调用时可通过 opts.terms 覆盖；命中后最多取前 8 个。
// ============================================================
const DEFAULT_TERMS = [
  // 财务 / 行政
  '借款', '报销', '付款', '备用金', '审批', '审核', '预算', '合同', '发票', '差旅费',
  '会议费', '业务费', '办公费', '广告费', '薪酬', '福利', '税费', '采购', '工程',
  '固定资产', 'OA', 'ERP', '增值税', '专用发票', '单据', '经办人', '部门负责人',
  '分管领导', '总经理', '财务', '出纳', '稽核', '月结', '现金', '转账', '应付款',
  '预付款', '押金', '备用金借款',
  // HR / 人事
  '年假', '病假', '婚假', '产假', '丧假', '工伤', '加班', '调休', '招聘', '入职',
  '离职', '转正', '社保', '公积金', '劳动合同', '试用期', '竞业限制', '违纪', '辞退',
  '考勤', '请假', '培训', '绩效', '考核', '工资', '薪资',
  // IT / 信息
  '账号', '密码', '权限', '系统', '网络', '服务器', '数据', '备份', '安全', '防火墙',
  '漏洞', '软件', '硬件', '设备', '邮箱', '域名', '接口', '日志', '加密', '数据库',
  // 法务 / 合规
  '合规', '风险', '诉讼', '仲裁', '知识产权', '商标', '专利', '保密', '隐私',
  '数据保护', '处罚', '违规', '法律', '法规', '章程', '协议',
  // 通用制度
  '制度', '规定', '办法', '流程', '申请', '备案', '报告', '会议', '通知', '用印',
  '盖章', '标准', '规范',
  // ===== 制造业核心板块 =====
  // 生产制造
  '生产', '工艺', '工序', '工单', '排产', '产能', '节拍', '产线', '流水线', '装配',
  '焊接', '注塑', '冲压', '涂装', '调试', '试产', '量产', '良率', '合格率', '报废',
  '返工', '在制品', '标准作业', '作业指导书', 'SOP', '工时', '定额', 'BOM',
  // 质量管理 / 质检
  '质量', '质检', '检验', '首件', '巡检', '抽检', '全检', '不良率', '缺陷', '客诉',
  '8D', '六西格玛', 'SPC', '控制图', '追溯', '批次', '召回', 'ISO9001', '体系',
  '认证', '计量', '校准', '公差', '尺寸',
  // 设备 / 维保
  '机床', '模具', '夹具', '刀具', '维保', '保养', '点检', 'TPM', '备件', '故障',
  '停机', 'OEE', '开机率', '大修', '润滑', '精度',
  // 供应链 / 采购 / 仓储
  '供应商', '物料', '原材料', '零部件', '库存', '安全库存', '齐套', '缺料', '物流',
  '仓储', '仓库', '出入库', '盘点', '寄售', '看板', 'JIT', '交付周期', '委外',
  '外协', '条码', '批次管理', '订单', '客户', '交付', '回款', '预测',
  // EHS 安全环保
  '环保', 'EHS', '职业健康', '危险源', '隐患', '应急预案', '演练', '事故', '防护用品',
  '三同时', '环评', '排污', '排放', '危废', '消防', '急救',
  // 研发 / 工程
  '研发', '工程', '设计', '图纸', '配方', '试制', '样件', 'PPAP', 'APQP', 'FMEA',
  '变更', '设变', 'NPI', '量产准备',
  // 精益 / 持续改善
  '精益', '5S', '整理', '整顿', '清扫', '清洁', '素养', '单元生产', '单件流',
  '价值流', '持续改善', '改善', '标准化', '防错', '快速换模', 'SMED', '安灯'
];

// 表格识别关键词（用于预清洗识别多列数据/表头行）。可通过 opts.approveKw 覆盖。
// 覆盖：审批权限表、价目表、规格表、排期表、名册表等常见表格类型。
const DEFAULT_APPROVE_KW = [
  '审批', '审核', '复核', '核准', '分管', '负责', '总经理', '部门', '权限', '区间',
  '万元', '以下', '以上', '金额', '价格', '单价', '数量', '规格', '型号', '日期',
  '时间', '期限', '天数', '等级', '标准', '类型', '名称', '说明', '备注', '合计',
  '小计', '总计', '占比', '状态', '结果', 'IP', '编号', '序列',
  // 制造业表格常见表头/列
  '工序', '设备', '良率', '工时', '定额', '库存', '安全库存', '供应商', '交期',
  '指标', '参考值', '单位', '限值', '上限', '下限', '公差', '不良率', '合格率',
  '参数', '阈值', '频次', '责任人'
];

// ============================================================
// 细分行业可选 preset（默认不加载，按需注入；覆盖高度专用的行业术语）
// 用法：opts.preset = 'gmp' | ['iatf16949','haccp'] | 'auto'(自动识别)
//   - terms：关键词词表（命中即抽）
//   - approveKw：该行业专属表格表头词（增强预清洗）
//   - sig：签名词，用于 detectPreset 自动识别（命中多为该行业）
// ============================================================
const PRESETS = {
  gmp: {
    label: 'GMP（药品生产）',
    terms: ['无菌', '洁净区', '洁净级别', '批记录', '批生产', '批包装', '工艺验证', '设备验证',
      '清洁验证', '再验证', '偏差', 'CAPA', '变更控制', '物料平衡', '印字', '标签', '说明书',
      '召回', '留样', '菌种', '培养基', '灭菌', '除菌', '内毒素', '热原', '含量', '效价',
      '杂质', '溶出', '含量均匀度', '微生物限度', '无菌检查', '共线', '交叉污染'],
    approveKw: ['批号', '效期', '规格', '装量', '限度', '洁净度', '浮游菌', '沉降菌'],
    sig: ['gmp', '无菌', '洁净区', '批记录', '工艺验证', '清洁验证', '药品生产']
  },
  iatf16949: {
    label: 'IATF16949（汽车）',
    terms: ['过程审核', 'VDA6.3', '产品审核', 'MSA', '测量系统', 'PPAP', 'APQP', 'FMEA',
      '控制计划', '特殊特性', 'SPC', 'CPK', '过程能力', '防错', 'Poka', '追溯件', '追溯性',
      '召回', '8D', '经验教训', '知识管理', '顾客特定要求', 'CSR', '嵌入式软件', 'ASPICE',
      '节拍', 'Andon', '拉式', '准时化', '混线生产', '误用工装'],
    approveKw: ['CPK', 'PPM', '缺陷率', '过程能力', '直通率'],
    sig: ['iatf', 'vda6.3', 'ppap', 'apqp', '控制计划', '特殊特性', '汽车行业', '顾客特定']
  },
  haccp: {
    label: 'HACCP（食品安全）',
    terms: ['关键控制点', 'CCP', '危害分析', '显著危害', '监控', '纠偏', '验证', 'PRP',
      '前提方案', '操作性前提方案', 'SSOP', '卫生标准', '致病菌', '菌落总数', '添加剂',
      '防腐剂', '保质期', '冷链', '冷藏', '冷冻', '解冻', '交叉污染', '异物', '金属探测',
      '过敏源', '追溯', '召回', '留样', '热处理', '杀菌'],
    approveKw: ['限值', 'CL', 'OL', '监控频率', '关键限值', '行动限值'],
    sig: ['haccp', '关键控制点', 'ccp', '危害分析', '食品安全', '致病菌', '过敏源']
  },
  iso13485: {
    label: 'ISO13485（医疗器械）',
    terms: ['医疗器械', '无菌器械', '植入器械', '有源器械', '体外诊断', '风险管理', 'UDI',
      '唯一标识', '注册', '注册证', '不良事件', '监测', '召回', '灭菌', '验证', '批记录',
      '留样', '生物相容性', '可用性', '软件确认', '可追溯', '无菌保证'],
    approveKw: ['UDI', '注册证号', '灭菌批'],
    sig: ['iso13485', '医疗器械', 'udi', '无菌器械', '植入器械', '注册证']
  },
  as9100: {
    label: 'AS9100（航空航天）',
    terms: ['构型', '构型管理', '适航', '首件检验', 'FAI', '关键件', '重要件', '特殊过程',
      '无损检测', 'NDT', '批次管理', '追溯', '假冒器材', 'counterfeit', '净成形', '关键特性'],
    approveKw: ['构型项', '适航标签', '适航批准'],
    sig: ['as9100', '构型管理', '适航', '首件检验', 'fai', '航空航天', '特殊过程', 'counterfeit', '假冒器材']
  }
};

/** 合并关键词词表：DEFAULT_TERMS + preset(s) + 自定义 terms（去重） */
function getTerms(opts = {}) {
  const list = [...DEFAULT_TERMS];
  const names = normalizePreset(opts.preset);
  for (const n of names) {
    const p = PRESETS[n];
    if (p && Array.isArray(p.terms)) list.push(...p.terms);
  }
  if (Array.isArray(opts.terms)) list.push(...opts.terms);
  return list;
}

/** 合并表格识别词表：DEFAULT_APPROVE_KW + preset(s) + 自定义 approveKw */
function getApproveKw(opts = {}) {
  const list = [...DEFAULT_APPROVE_KW];
  const names = normalizePreset(opts.preset);
  for (const n of names) {
    const p = PRESETS[n];
    if (p && Array.isArray(p.approveKw)) list.push(...p.approveKw);
  }
  if (Array.isArray(opts.approveKw)) list.push(...opts.approveKw);
  return list;
}

/** 将 preset 参数规范化为数组（'auto' 走自动识别需结合文本，这里仅做名称归一） */
function normalizePreset(preset) {
  if (!preset) return [];
  if (Array.isArray(preset)) return preset.filter(Boolean);
  return [preset];
}

/** 自动识别文档所属细分行业 preset（基于签名词命中数排序返回名称数组，可信度降序） */
function detectPreset(text) {
  const t = (text || '').toLowerCase();
  const hits = {};
  for (const [name, p] of Object.entries(PRESETS)) {
    const sig = p.sig || [];
    let score = 0;
    for (const k of sig) { if (t.includes(k.toLowerCase())) score++; }
    if (score > 0) hits[name] = score;
  }
  return Object.entries(hits).sort((a, b) => b[1] - a[1]).map(x => x[0]);
}

// 表格勾选符号集合
const TABLE_CHECK = new Set(['√', '✓', '×', '✗', '☑', '✅', '✔', '✘', '●', '○', '■', '□', '◻', '▲', '△']);
// 真实句子标志词：含这些基本可判定为完整句子而非表格单元格（保护真实规则不被误删）
const SENT_MARK = /[的是须应由经按需指包含按对于为给向在将可不每各该：，、？?。！；;（）()]/;

/**
 * 预清洗：剔除高置信噪声行（表格边框/分隔/勾选/单元格行），
 * 同时严格「不影响真实规则完整性」。
 * @param {string} text
 * @param {object} [opts] { approveKw?: string[], sentMark?: RegExp, tableCheck?: Set }
 */
function prefilterText(text, opts = {}) {
  const approveKw = getApproveKw(opts);
  const sentMark = opts.sentMark || SENT_MARK;
  const tableCheck = opts.tableCheck || TABLE_CHECK;
  const lines = (text || '').split(/\r?\n/);
  const out = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (t === '') { out.push(raw); continue; }
    // 1) 纯边框/分隔/勾选符行（只含表格线字符）
    if (/^[\s\u2500-\u257F|+\-=~*·•]+$/.test(t)) continue;
    // 2) Markdown 表格分隔行 | --- | --- |
    if (/^\s*\|?[\s:|\-]+\|?\s*$/.test(t)) continue;
    // 3) 纯勾选符行
    if (/^[\s√×✓✗●○■□◻✔✘\-]+$/.test(t)) continue;
    // 4) 含 | 的表格行（≥2 个单元格、无句末标点）
    if (t.includes('|')) {
      const cells = t.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2 && !/[。！？；;？?]/.test(t)) continue;
    }
    // 5) 空格/制表符分隔的多列短词行（表格数据/表头）：
    //    段数 ≥3、无句末标点、无真实句子标志词，且（末段为勾选符 或 含表格类关键词且各段≤6字）
    const tokens = t.split(/\s+/).filter(Boolean);
    if (tokens.length >= 3 && !/[。！？；;？?]/.test(t) && !sentMark.test(t)) {
      const lastChk = tableCheck.has(tokens[tokens.length - 1].replace(/^[-]+/, ''));
      const allShort = tokens.every(tk => tk.replace(/[√×✓✗●○■□◻✔✘\-]/g, '').length <= 6);
      const hasApprove = tokens.some(tk => approveKw.some(k => tk.includes(k)));
      if (lastChk || (hasApprove && allShort)) continue;
    }
    out.push(raw);
  }
  return out.join('\n');
}

/** 自动提取关键词：书名号引用 + 领域词表命中（英文词大小写不敏感）。
 *  词表优先级：DEFAULT_TERMS < preset(s) < 自定义 terms。可通过 opts 注入。 */
function extractKeywords(q, a, opts = {}) {
  const terms = getTerms(opts);
  const text = (q || '') + ' ' + (a || '');
  const textLower = text.toLowerCase();
  const kw = [];
  const m = text.match(/《([^》]+)》/g);
  if (m) m.forEach(x => { const w = x.replace(/[《》]/g, '').trim(); if (w && !kw.includes(w)) kw.push(w); });
  for (const t of terms) {
    if (textLower.includes(t.toLowerCase()) && !kw.includes(t)) kw.push(t);
  }
  return kw.slice(0, 8);
}

// 去前缀编号：兼容 1. / 3.1. / 4.1.2. / 3.3分管领导 / 一、 / 二) / A. / b) 等多级写法
//  - 阿拉伯编号：分隔符可选（允许「3.3分管领导」无空格）
//  - 中文编号：分隔符必选（避免误剥「一类城市」「三类地区」中的「一/三」）
//  - 拉丁字母大纲：单字母 + 分隔符（A. B) 等英文/混排大纲）
const reNumPrefix = /^(\d+(\.\d+)*[.、)）\s]*|[一二三四五六七八九十百千零]+[.、)）\s]+|[A-Za-z][.、)）\s]+)/;
const stripNum = (s) => s.replace(reNumPrefix, '').trim();

/** 由规则文本派生「问题」：与完整答案明显区分且人类可读 */
function deriveQuestion(raw, kind) {
  let s = stripNum(raw);
  if (kind === 'title' || kind === 'bracket') {
    return s.length ? s : raw.trim();
  }
  // 定义式：X.X. 术语：释义
  const ci = s.indexOf('：');
  if (ci > 0 && ci <= 15 && !/[。！？；;]/.test(s.slice(0, ci))) {
    return s.slice(0, ci).trim();
  }
  const first = s.split(/[。！？\?!；;]/)[0].trim();
  if (first.length >= 4) return first.length > 50 ? first.slice(0, 50) + '…' : first;
  return s.slice(0, 30);
}

/**
 * 确定性正则抽取（完整性基石）。返回 [{question, answer, keywords}]。
 * 支持：Q/A 标记、编号条目(1. / 一、 / A.)、#标题、【方括号标题】、项目符号、
 *       含问号行(问?答)、普通段落。问答同体及过短废条在此过滤。
 * @param {string} text
 * @param {string} category
 * @param {object} [opts] { terms?, approveKw?, sentMark?, tableCheck? }
 */
function parseDocToFAQ(text, category, opts = {}) {
  // 预设自动识别：preset==='auto' 时基于签名词判定细分行业
  const resolvedOpts = opts.preset === 'auto' ? { ...opts, preset: detectPreset(text) } : opts;
  const reQ = /^(Q|q|问题|问)[:：\s]/;
  const reA = /^(A|a|答案|答)[:：\s]/;
  const reNum = reNumPrefix;
  const reTitle = /^#{1,6}\s+/;
  const reBracketTitle = /^[【\[][^】\]]+[】\]]$/;
  const reBullet = /^[-•*·]\s+/;
  const hasQmark = (s) => /[？?]/.test(s);
  const hasSentPunct = (s) => /[。！？！；;？?]/.test(s);

  const out = [];
  let cur = null;

  const flush = () => {
    if (!cur) return;
    const a = (cur.a || '').trim();
    const qRaw = (cur.q || '').trim();
    if (a) {
      const q = (qRaw && qRaw.length > 1 ? qRaw : deriveQuestion(a, cur.kind)).slice(0, 200);
      out.push({ question: q, answer: a.slice(0, 2000) });
    } else if (qRaw) {
      const isSectionHeader = (cur.kind === 'title' || cur.kind === 'bracket' ||
        (cur.kind === 'num' && qRaw.length <= 12 && !hasSentPunct(qRaw) && !qRaw.includes('：')));
      if (!isSectionHeader) {
        const q = deriveQuestion(qRaw, cur.kind);
        out.push({ question: q.slice(0, 200), answer: qRaw.slice(0, 2000) });
      }
    }
    cur = null;
  };

  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t === '') { flush(); continue; }
    if (reA.test(t)) {
      if (!cur) cur = { q: '', a: '', kind: 'qa' };
      const ans = t.replace(reA, '').trim();
      cur.a = cur.a ? cur.a + '\n' + ans : ans;
      continue;
    }
    if (reQ.test(t)) { flush(); cur = { q: t.replace(reQ, '').trim(), a: '', kind: 'qa' }; continue; }
    if (reNum.test(t)) { flush(); cur = { q: t, a: '', kind: 'num' }; continue; }
    if (reTitle.test(t)) { flush(); cur = { q: t.replace(/^#{1,6}\s+/, '').trim(), a: '', kind: 'title' }; continue; }
    if (reBracketTitle.test(t)) { flush(); cur = { q: t, a: '', kind: 'bracket' }; continue; }
    if (reBullet.test(t)) { flush(); cur = { q: t.replace(reBullet, '').trim(), a: '', kind: 'bullet' }; continue; }
    if (hasQmark(t)) {
      flush();
      const idx = t.search(/[？?]/);
      cur = { q: t.slice(0, idx).trim(), a: t.slice(idx + 1).trim(), kind: 'qmark' };
    } else {
      if (!cur) cur = { q: '', a: '', kind: 'para' };
      cur.a = cur.a ? cur.a + '\n' + t : t;
    }
  }
  flush();

  const enriched = out.map(x => ({ ...x, keywords: extractKeywords(x.question, x.answer, resolvedOpts) }));
  return enriched.filter(x =>
    x.question && x.answer &&
    x.question.trim() !== x.answer.trim() &&
    (x.question.length >= 2 || x.answer.length >= 4)
  );
}

/** 批量润色提示词：把正则抽取条目改写为自然语言问句 + 关键词（领域无关） */
function buildPolishPrompt(group, category) {
  const catHint = category && category !== '其他' ? `（文档分类：${category}）` : '';
  const items = group.map((b, i) =>
    `[${i}] question: ${b.question}\nanswer: ${b.answer}`
  ).join('\n\n');
  return `你是企业FAQ问答润色助手${catHint}。下面是一批从制度文档抽取的FAQ条目（[序号] 为条目id）。
请为每条做两件事：
1) 把 question 改写为员工会自然语言提出的问题或条目主题（例如"差旅费的定义是什么""报销时限是多久""借款审批流程是什么"），去除编号前缀（如不要"3.1"），保持简洁（≤30字）
2) 生成 3-5 个核心检索关键词（如 借款/报销/审批/预算）
answer 保持不变，不要改写。
返回 JSON：{"items":[{"id":number,"question":string,"keywords":[string]}]}，只输出 JSON，不要解释。
条目：
"""
${items}
"""`;
}

/**
 * 合并关键词：正则词表(基于领域词表命中) ∪ LLM 语义词，去重后取前 8 个。
 * 这样关键词既保留词表全量命中，又纳入 LLM 补的语义词，检索召回更全。
 * @param {string[]} regularKw 正则抽取阶段用领域词表提取的关键词
 * @param {string[]|undefined} llmKw LLM 润色返回的关键词（可能为空/undefined）
 */
function mergeKeywords(regularKw, llmKw) {
  const a = Array.isArray(regularKw) ? regularKw : [];
  const b = Array.isArray(llmKw) ? llmKw : [];
  const merged = [];
  for (const k of a.concat(b)) {
    if (k && !merged.includes(k)) merged.push(k);
  }
  return merged.slice(0, 8);
}

/**
 * 混合解析主入口：预清洗 → 正则抽取 → LLM 批量润色 → 合并去重。
 * @param {string} text      文档纯文本
 * @param {string} category  文档分类（如 '财务'/'差旅'/'HR'/'IT'/'其他'）
 * @param {Function} llmFn   可选；(prompt, options) => Promise<{items:[...]}|null>
 *                           不传则仅返回正则结果（零依赖、绝不报错）。
 * @param {object} [opts]    领域自适应：{ terms?: string[], approveKw?: string[],
 *                           sentMark?: RegExp, tableCheck?: Set }
 * @returns {Promise<Array<{question,answer,keywords}>>}
 */
async function parseDocToFAQWithLLM(text, category, llmFn, opts = {}) {
  const cleaned = (text || '').trim();
  if (!cleaned) return [];

  // 预设自动识别：preset==='auto' 时基于签名词判定细分行业
  const resolvedOpts = opts.preset === 'auto' ? { ...opts, preset: detectPreset(cleaned) } : opts;

  // 0) 预清洗
  const prefiltered = prefilterText(cleaned, resolvedOpts);

  // 1) 确定性正则抽取（完整性基石）
  const base = parseDocToFAQ(prefiltered, category, resolvedOpts);
  if (base.length === 0) {
    return [{ question: prefiltered.slice(0, 200).trim(), answer: prefiltered.slice(0, 2000), keywords: [] }];
  }

  // 2) LLM 批量润色（质量增强，失败则保留正则结果）
  const BATCH = 10;
  const polished = {};
  if (typeof llmFn === 'function') {
    for (let i = 0; i < base.length; i += BATCH) {
      const group = base.slice(i, i + BATCH);
      const prompt = buildPolishPrompt(group, category);
      let parsed = null;
      try {
        parsed = await llmFn(prompt, { temperature: 0, max_tokens: 4096, timeout: 120000 });
      } catch (e) {
        console.warn(`[LLM-POLISH] 第 ${Math.floor(i / BATCH) + 1} 批润色失败:`, e && e.message);
      }
      const arr = parsed && Array.isArray(parsed.items) ? parsed.items : [];
      for (const it of arr) {
        const id = Number(it.id);
        if (!Number.isInteger(id) || id < 0 || id >= base.length) continue;
        const q = (it.question || '').toString().trim();
        const kw = Array.isArray(it.keywords)
          ? it.keywords.map(k => k.toString().trim()).filter(Boolean).slice(0, 8)
          : [];
        if (q.length >= 2) polished[id] = { question: q.slice(0, 200), keywords: kw };
      }
    }
  }

  // 3) 合并：不删除任何条目（保证完整性）；关键词取「正则词表 ∪ LLM 语义词」并集去重，
  //    既保留领域词表全量命中，又纳入 LLM 补的语义词，最多 8 个。
  const out = base.map((b, idx) => {
    const p = polished[idx];
    return {
      question: (p && p.question) || b.question,
      answer: b.answer,
      keywords: mergeKeywords(b.keywords, p && p.keywords)
    };
  });

  // 轻量去重（同问题大小写不敏感）
  const seen = new Set();
  const dedup = [];
  for (const x of out) {
    const key = x.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(x);
  }

  console.log(`[LLM-POLISH] 正则提取 ${base.length} 条 → LLM 润色 ${Object.keys(polished).length} 条 → 去重后 ${dedup.length} 条`);
  return dedup;
}

module.exports = {
  prefilterText,
  extractKeywords,
  stripNum,
  reNumPrefix,
  deriveQuestion,
  parseDocToFAQ,
  buildPolishPrompt,
  parseDocToFAQWithLLM,
  DEFAULT_TERMS,
  DEFAULT_APPROVE_KW,
  PRESETS,
  getTerms,
  getApproveKw,
  detectPreset,
  normalizePreset,
  SENT_MARK,
  TABLE_CHECK
};
