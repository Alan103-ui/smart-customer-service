/**
 * 日志系统单元测试（简化版）
 * 测试 logger.js 模块的核心功能
 */

const {
  performanceMiddleware, auditLog, errorLog,
  getLogFiles, readLogFile, cleanOldLogs, writeLog, LEVELS
} = require('./logger');

describe('日志系统模块测试', () => {
  test('LEVELS 常量定义正确', () => {
    expect(LEVELS.INFO).toBe('INFO');
    expect(LEVELS.WARN).toBe('WARN');
    expect(LEVELS.ERROR).toBe('ERROR');
    expect(LEVELS.AUDIT).toBe('AUDIT');
    expect(LEVELS.PERF).toBe('PERF');
  });
  
  test('writeLog 函数存在且可调用', () => {
    expect(typeof writeLog).toBe('function');
  });
  
  test('performanceMiddleware 是函数', () => {
    expect(typeof performanceMiddleware).toBe('function');
  });
  
  test('performanceMiddleware 接受3个参数', () => {
    expect(performanceMiddleware.length).toBe(3);
  });
  
  test('auditLog 函数存在', () => {
    expect(typeof auditLog).toBe('function');
  });
  
  test('errorLog 函数存在', () => {
    expect(typeof errorLog).toBe('function');
  });
  
  test('getLogFiles 返回数组', () => {
    const files = getLogFiles();
    expect(Array.isArray(files)).toBe(true);
  });
  
  test('readLogFile 函数存在', () => {
    expect(typeof readLogFile).toBe('function');
  });
  
  test('cleanOldLogs 函数存在', () => {
    expect(typeof cleanOldLogs).toBe('function');
  });
  
  test('performanceMiddleware 调用 next 函数', (done) => {
    const req = { method: 'GET', url: '/test', ip: '127.0.0.1', connection: { remoteAddress: '127.0.0.1' }, get: () => null };
    const res = { statusCode: 200, send: (body) => body };
    const next = jest.fn(() => {
      expect(next).toHaveBeenCalled();
      done();
    });
    
    performanceMiddleware(req, res, next);
  });
});
