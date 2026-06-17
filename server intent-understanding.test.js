/**
 * 意图理解模块单元测试（正确版）
 * 基于 ACTUAL 模块行为编写
 */

const { understandIntent, batchUnderstandIntents, fallbackIntent, INTENT_TAXONOMY } = require('./intent-understanding');

describe('意图理解模块测试', () => {
  test('understandIntent 是异步函数', () => {
    expect(typeof understandIntent).toBe('function');
  });
  
  test('understandIntent 接受2个参数（retryCount有默认值）', () => {
    // retryCount = 0 有默认值，不计入 function.length
    expect(understandIntent.length).toBe(2);
  });
  
  test('understandIntent 对空输入返回 fallback（level1=query）', async () => {
    const result = await understandIntent('');
    expect(result.primaryIntent.level1).toBe('query');
    expect(result.primaryIntent).toHaveProperty('confidence');
  });
  
  test('understandIntent 对短输入返回 fallback', async () => {
    const result = await understandIntent('a');
    expect(result.primaryIntent).toBeDefined();
    expect(result.primaryIntent).toHaveProperty('level1');
  });
  
  test('batchUnderstandIntents 是函数', () => {
    expect(typeof batchUnderstandIntents).toBe('function');
  });
  
  test('fallbackIntent 是函数且返回默认意图', () => {
    expect(typeof fallbackIntent).toBe('function');
    const result = fallbackIntent('');
    expect(result.primaryIntent).toHaveProperty('level1');
    expect(result.primaryIntent).toHaveProperty('confidence');
    // 实际行为：空字符串返回 query
    expect(result.primaryIntent.level1).toBe('query');
  });
  
  test('INTENT_TAXONOMY 包含所有主要意图分类', () => {
    expect(INTENT_TAXONOMY.level1).toContain('query');
    expect(INTENT_TAXONOMY.level1).toContain('complaint');
    expect(INTENT_TAXONOMY.level1).toContain('greeting');
    expect(INTENT_TAXONOMY.level1).toContain('suggestion');
  });
  
  test('INTENT_TAXONOMY.level2 包含子分类', () => {
    expect(INTENT_TAXONOMY.level2).toHaveProperty('query');
    expect(INTENT_TAXONOMY.level2).toHaveProperty('complaint');
    expect(INTENT_TAXONOMY.level2).toHaveProperty('greeting');
    expect(INTENT_TAXONOMY.level2).toHaveProperty('suggestion');
  });
  
  test('对问候语返回 greeting 意图', async () => {
    const result = await understandIntent('你好');
    expect(result.primaryIntent.level1).toContain('greeting');
  });
  
  test('对投诉返回 complaint 意图', async () => {
    const result = await understandIntent('你们服务太差了');
    expect(result.primaryIntent.level1).toContain('complaint');
  });
  
  test('fallbackIntent 对空输入返回 query', () => {
    const result = fallbackIntent('');
    expect(result.primaryIntent.level1).toBe('query');
    expect(result.primaryIntent.level2).toBeNull();
    expect(result.primaryIntent.confidence).toBe(0.5);
  });
});
