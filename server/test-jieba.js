/**
 * 测试nodejieba中文分词效果
 */

const jieba = require('nodejieba');

// 初始化
jieba.load();

// 测试用例
const testTexts = [
  '如何申请报销',
  '报销需要哪些材料',
  '审批需要多长时间',
  '在线报销系统支持哪些银行',
  '今天天气怎么样'
];

console.log('========== 测试nodejieba中文分词 ==========\n');

for (const text of testTexts) {
  console.log(`原文: ${text}`);
  
  // 精确模式分词
  const words = jieba.cut(text, true);
  console.log(`分词: [${words.join(', ')}]`);
  
  // 过滤停用词
  const STOP_WORDS = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', 
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', 
    '自己', '这', '那', '什么', '怎么', '如何', '为什么', '吗', '呢', '吧', '啊', '嗯']);
  
  const filtered = words.filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  console.log(`关键词: [${filtered.join(', ')}]`);
  console.log('');
}

console.log('========== 测试完成 ==========');
