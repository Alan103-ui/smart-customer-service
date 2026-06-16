/**
 * 日志系统模块
 * - 请求性能监控（响应时间）
 * - 错误日志记录
 * - 关键操作审计日志
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// 日志级别
const LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  AUDIT: 'AUDIT',
  PERF: 'PERF'  // 性能监控
};

/**
 * 写入日志文件
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {object} meta - 额外元数据
 */
function writeLog(level, message, meta = {}) {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const timeStr = now.toISOString();
  const logFile = path.join(LOGS_DIR, `${dateStr}.log`);
  
  const logEntry = {
    timestamp: timeStr,
    level,
    message,
    ...meta
  };
  
  const logLine = JSON.stringify(logEntry) + '\n';
  
  try {
    fs.appendFileSync(logFile, logLine);
  } catch (e) {
    console.error('[Logger] 写入日志失败:', e.message);
  }
  
  // 同时输出到控制台（开发环境）
  if (level === LEVELS.ERROR) {
    console.error(`[${level}] ${message}`, meta);
  } else if (level === LEVELS.WARN) {
    console.warn(`[${level}] ${message}`, meta);
  } else {
    console.log(`[${level}] ${message}`, meta);
  }
}

/**
 * 性能监控中间件
 * 记录每个API请求的响应时间
 */
function performanceMiddleware(req, res, next) {
  const start = Date.now();
  
  // 拦截 res.send 以计算响应时间
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - start;
    const logMeta = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      durationMs: duration,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent')
    };
    
    // 记录性能日志（慢请求警告 >500ms）
    if (duration > 500) {
      writeLog(LEVELS.WARN, `慢请求: ${req.method} ${req.url} (${duration}ms)`, logMeta);
    } else {
      writeLog(LEVELS.PERF, `${req.method} ${req.url} (${duration}ms)`, logMeta);
    }
    
    // 调用原始 send
    originalSend.call(this, body);
  };
  
  next();
}

/**
 * 审计日志 - 记录关键操作
 * @param {string} operation - 操作名称（如 'faq_create', 'faq_update', 'faq_delete'）
 * @param {string} operator - 操作人（可从请求中获取，默认 'system'）
 * @param {object} details - 操作详情
 */
function auditLog(operation, operator = 'system', details = {}) {
  writeLog(LEVELS.AUDIT, `操作: ${operation}`, {
    operator,
    operation,
    details
  });
}

/**
 * 错误日志 - 记录异常
 * @param {string} message - 错误消息
 * @param {object} error - 错误对象
 * @param {object} context - 上下文信息
 */
function errorLog(message, error = null, context = {}) {
  writeLog(LEVELS.ERROR, message, {
    error: error ? { message: error.message, stack: error.stack } : null,
    context
  });
}

/**
 * 获取日志文件列表
 * @returns {Array} - 日志文件列表 [{filename, size, createdAt}]
 */
function getLogFiles() {
  try {
    const files = fs.readdirSync(LOGS_DIR);
    return files
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const filePath = path.join(LOGS_DIR, f);
        const stat = fs.statSync(filePath);
        return {
          filename: f,
          size: stat.size,
          createdAt: stat.birthtime,
          path: filePath
        };
      })
      .sort((a, b) => b.filename.localeCompare(a.filename)); // 按日期降序
  } catch (e) {
    errorLog('获取日志文件列表失败', e);
    return [];
  }
}

/**
 * 读取日志文件内容
 * @param {string} filename - 日志文件名（如 '2026-06-17.log'）
 * @param {number} limit - 返回行数限制（默认100）
 * @param {string} level - 按日志级别过滤（可选）
 * @returns {Array} - 日志条目数组
 */
function readLogFile(filename, limit = 100, level = null) {
  try {
    const filePath = path.join(LOGS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`日志文件不存在: ${filename}`);
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.trim().split('\n');
    
    let logs = lines
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (e) {
          return null;
        }
      })
      .filter(log => log !== null);
    
    // 按级别过滤
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    
    // 返回最近的 limit 条
    return logs.slice(-limit);
  } catch (e) {
    errorLog('读取日志文件失败', e, { filename });
    return [];
  }
}

/**
 * 清理旧日志（保留最近N天）
 * @param {number} daysToKeep - 保留天数（默认7天）
 */
function cleanOldLogs(daysToKeep = 7) {
  try {
    const files = getLogFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    
    let cleaned = 0;
    for (const file of files) {
      const fileDate = new Date(file.filename.slice(0, 10));
      if (fileDate < cutoff) {
        fs.unlinkSync(file.path);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      writeLog(LEVELS.INFO, `清理旧日志: ${cleaned} 个文件`, { cleaned, daysToKeep });
    }
  } catch (e) {
    errorLog('清理旧日志失败', e);
  }
}

module.exports = {
  LEVELS,
  performanceMiddleware,
  auditLog,
  errorLog,
  getLogFiles,
  readLogFile,
  cleanOldLogs,
  writeLog
};
