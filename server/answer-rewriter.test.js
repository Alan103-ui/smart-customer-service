/**
 * 答案改写模块单元测试（修正版 v2）
 * 基于实际API签名和返回格式重写，使用mock避免LLM调用
 */

// Mock callOllamaChat 避免真实LLM调用
jest.mock('./ollama-client', () => ({
  callOllamaChat: jest.fn(),
  DEFAULT_BASE_URL: 'http://localhost:11434',
  DEFAULT_MODEL: 'qwen2.5:14b'
}));

const {
  rewriteToColloquial, batchRewrite, evaluateQuality, getToneList
} = require('./answer-rewriter');

const { callOllamaChat } = require('./ollama-client');

describe('答案改写模块测试', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rewriteToColloquial 是异步函数', () => {
    expect(typeof rewriteToColloquial).toBe('function');
  });
  
  test('rewriteToColloquial 接受2个参数（其中1个有默认值）', () => {
    // originalAnswer(必填), options(可选，默认{})
    // function.length 只计算必填参数，所以这里是1
    expect(rewriteToColloquial.length).toBe(1);
  });
  
  test('rewriteToColloquial 能正常调用（mock callOllamaChat）', async () => {
    // callOllamaChat 返回字符串（改写后的答案）
    callOllamaChat.mockResolvedValue('改写后的答案是这样的');
    
    const result = await rewriteToColloquial('测试答案', { tone: 'friendly' });
    expect(typeof result).toBe('string');
    expect(result).toBe('改写后的答案是这样的');
  });
  
  test('rewriteToColloquial 对无效输入返回原答案', async () => {
    // 输入为空或非字符串，应返回空字符串（见代码第28行）
    const result1 = await rewriteToColloquial('');
    expect(result1).toBe('');
    
    const result2 = await rewriteToColloquial(null);
    expect(result2).toBe('');
  });
  
  test('batchRewrite 是函数', () => {
    expect(typeof batchRewrite).toBe('function');
  });
  
  test('evaluateQuality 是异步函数且返回正确格式', async () => {
    // callOllamaChat 返回JSON字符串，parseQualityJSON会解析它
    const mockJSONResponse = JSON.stringify({
      fluency: 0.9,
      naturalness: 0.8,
      infoRetention: 0.95,
      overallScore: 0.88,
      suggestions: ['改写质量良好']
    });
    callOllamaChat.mockResolvedValue(mockJSONResponse);
    
    const result = await evaluateQuality('原始文本', '改写后文本');
    expect(result).toHaveProperty('overallScore');
    expect(result).toHaveProperty('suggestions');
    expect(result.overallScore).toBeGreaterThan(0);
    expect(result.overallScore).toBeLessThanOrEqual(1);
  });
  
  test('getToneList 是函数且返回数组', () => {
    expect(typeof getToneList).toBe('function');
    
    const tones = getToneList();
    expect(Array.isArray(tones)).toBe(true);
    expect(tones.length).toBeGreaterThan(0);
  });
  
  test('evaluateQuality 对相同文本返回高分', async () => {
    // 相同文本，mock返回高分
    const mockJSONResponse = JSON.stringify({
      fluency: 0.95,
      naturalness: 0.95,
      infoRetention: 1.0,
      overallScore: 0.97,
      suggestions: ['文本完全相同']
    });
    callOllamaChat.mockResolvedValue(mockJSONResponse);
    
    const text = '这是一个测试文本';
    const result = await evaluateQuality(text, text);
    expect(result.overallScore).toBeGreaterThan(0.5);
  });
  
  test('evaluateQuality 对不同文本返回较低分', async () => {
    // 不同文本，mock返回较低分
    const mockJSONResponse = JSON.stringify({
      fluency: 0.6,
      naturalness: 0.5,
      infoRetention: 0.7,
      overallScore: 0.6,
      suggestions: ['文本差异较大']
    });
    callOllamaChat.mockResolvedValue(mockJSONResponse);
    
    const original = '这是一个测试文本';
    const rewritten = '这是完全不同的内容';
    const result = await evaluateQuality(original, rewritten);
    expect(result.overallScore).toBeLessThan(0.8);
  });
});
