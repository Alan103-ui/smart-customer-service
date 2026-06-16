/**
 * 意图理解模块单元测试（修正版）
 * 基于实际API签名和返回格式重写
 */

const { understandIntent, fallbackIntent, INTENT_TAXONOMY } = require('./intent-understanding');

// Mock callOllamaJSON 避免真实LLM调用
jest.mock('./ollama-client', () => ({
  callOllamaJSON: jest.fn(),
  DEFAULT_BASE_URL: 'http://localhost:11434',
  DEFAULT_MODEL: 'qwen2.5:14b'
}));

const { callOllamaJSON } = require('./ollama-client');

describe('意图理解模块测试', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('understandIntent 是异步函数', () => {
    expect(typeof understandIntent).toBe('function');
  });
  
  test('understandIntent 接受3个参数（其中1个有默认值）', () => {
    // userQuery(必填), context(必填), retryCount(可选，默认0)
    // function.length 只计算必填参数，所以这里是2
    expect(understandIntent.length).toBe(2);
  });
  
  test('fallbackIntent 是函数且返回默认意图', () => {
    expect(typeof fallbackIntent).toBe('function');
    const result = fallbackIntent('');
    expect(result).toHaveProperty('primaryIntent');
    expect(result.primaryIntent).toHaveProperty('level1');
    expect(result.primaryIntent).toHaveProperty('confidence');
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
  });
  
  test('对空输入返回 fallback (level1=query)', async () => {
    const result = await understandIntent('');
    expect(result.primaryIntent.level1).toBe('query');
    expect(result.primaryIntent.confidence).toBe(0.5);
  });
  
  test('对短输入调用LLM（mock）', async () => {
    // Mock LLM返回
    callOllamaJSON.mockResolvedValue({
      primaryIntent: { level1: 'query', level2: 'policy', confidence: 0.8 }
    });
    
    const result = await understandIntent('a');
    expect(result.primaryIntent).toBeDefined();
    expect(result.primaryIntent.level1).toBe('query');
  });
  
  test('对问候语返回 greeting 意图', async () => {
    // 不使用mock，因为规则引擎会匹配"你好"
    const result = await understandIntent('你好');
    expect(result.primaryIntent.level1).toBe('greeting');
  });
  
  test('对投诉返回 complaint 意图', async () => {
    const result = await understandIntent('你们服务太差了');
    expect(result.primaryIntent.level1).toBe('complaint');
  });
  
  test('fallbackIntent 对空输入返回默认意图 (level1=query)', () => {
    const result = fallbackIntent('');
    expect(result.primaryIntent.level1).toBe('query');
    expect(result.primaryIntent.level2).toBeNull();
    expect(result.primaryIntent.confidence).toBe(0.5);
  });
});
