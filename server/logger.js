/**
 * 日志系统模块
 * - 请求性能监控（响应时间）
 * - 错误日志记录
 * - 关键操作审计日志
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = process.env.LOG_DIR
  ? path.resolve(process.env.LOG_DIR)
  : path.join(__dirname, '../logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// 日志轮转配置（按大小切割，防止单文件无限增长撑满磁盘）
const MAX_LOG_SIZE = process.env.LOG_MAX_SIZE
  ? parseInt(process.env.LOG_MAX_SIZE, 10)
  : 50 * 1024 * 1024; // 单文件上限 50MB
const MAX_LOG_ROLLS = process.env.LOG_MAX_ROLLS
  ? parseInt(process.env.LOG_MAX_ROLLS, 10)
  : 9; // 单日最多保留 9 个滚动历史文件（.1 ~ .9）

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
    // 按大小轮转：写入前若当前文件 + 本行将超过上限，先滚动再写，避免单文件无限增长
    let size = 0;
    try { size = fs.statSync(logFile).size; } catch (e) { /* 文件尚不存在 */ }
    if (size + Buffer.byteLength(logLine, 'utf8') > MAX_LOG_SIZE) {
      rotateLogFile(logFile);
    }
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
 * @param {object} options
 * @param {boolean} options.summary - 是否附加级别统计（行数 + 各级别计数）
 * @returns {Array} - 日志文件列表 [{filename, size, createdAt, modifiedAt, lines?, levelCounts?}]
 */
function getLogFiles({ summary = false } = {}) {
  try {
    const files = fs.readdirSync(LOGS_DIR);
    return files
      .filter(f => f.endsWith('.log'))
      .map(f => {
        const filePath = path.join(LOGS_DIR, f);
        const stat = fs.statSync(filePath);
        const entry = {
          filename: f,
          size: stat.size,
          createdAt: stat.birthtime,
          modifiedAt: stat.mtime,
          path: filePath
        };
        if (summary) {
          // 轻量统计：不逐行 JSON.parse，用正则计数，性能友好
          const raw = fs.readFileSync(filePath, 'utf8');
          const lines = raw.split('\n').filter(l => l.trim()).length;
          const counts = { INFO: 0, WARN: 0, ERROR: 0, AUDIT: 0, PERF: 0 };
          for (const lvl of Object.keys(counts)) {
            const re = new RegExp('"level":"' + lvl + '"', 'g');
            counts[lvl] = (raw.match(re) || []).length;
          }
          entry.lines = lines;
          entry.levelCounts = counts;
        }
        return entry;
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
 * @param {string} search - 按消息关键词过滤（可选，不区分大小写）
 * @returns {Array} - 日志条目数组
 */
function readLogFile(filename, limit = 100, level = null, search = null) {
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
          // 兼容纯文本日志（如 server.log）：作为原始文本条目
          return { timestamp: null, level: 'RAW', message: line };
        }
      })
      .filter(log => log !== null);
    
    // 按级别过滤
    if (level) {
      logs = logs.filter(log => log.level === level);
    }
    
    // 按关键词过滤
    if (search) {
      const s = String(search).toLowerCase();
      logs = logs.filter(log => {
        const msg = String(log.message || '').toLowerCase();
        const meta = JSON.stringify(log).toLowerCase();
        return msg.includes(s) || meta.includes(s);
      });
    }
    
    // 返回最近的 limit 条
    return logs.slice(-limit);
  } catch (e) {
    errorLog('读取日志文件失败', e, { filename });
    return [];
  }
}

/**
 * 日志文件按大小滚动
 * 当当日日志文件超过 MAX_LOG_SIZE 时，将其滚动为带序号的文件：
 *   YYYY-MM-DD.log → YYYY-MM-DD.log.1 → YYYY-MM-DD.log.2 → ...
 * 序号越大越旧，达到 MAX_LOG_ROLLS 上限时删除最旧的一个。
 * @param {string} logFile - 当前日志文件路径（YYYY-MM-DD.log）
 */
function rotateLogFile(logFile) {
  try {
    if (!fs.existsSync(logFile)) return;
    const dir = path.dirname(logFile);
    const base = path.basename(logFile); // YYYY-MM-DD.log

    // 收集已有滚动文件 YYYY-MM-DD.log.N 的序号
    const rollNums = fs.readdirSync(dir)
      .filter(f => f.startsWith(base + '.') && /^\d+$/.test(f.slice(base.length + 1)))
      .map(f => parseInt(f.slice(base.length + 1), 10))
      .filter(n => Number.isInteger(n) && n > 0)
      .sort((a, b) => b - a); // 降序：最大序号在前

    const maxRoll = rollNums.length ? rollNums[0] : 0;

    // 已达上限：删除最旧的滚动文件，腾出 .MAX_LOG_ROLLS
    if (maxRoll >= MAX_LOG_ROLLS) {
      const oldest = path.join(dir, base + '.' + MAX_LOG_ROLLS);
      if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
    }

    // 从后往前推移：N → N+1，最后把当前文件置为 .1
    const top = Math.min(maxRoll, MAX_LOG_ROLLS - 1);
    for (let n = top; n >= 1; n--) {
      const src = path.join(dir, base + '.' + n);
      const dst = path.join(dir, base + '.' + (n + 1));
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
    fs.renameSync(logFile, path.join(dir, base + '.1'));
  } catch (e) {
    console.error('[Logger] 日志滚动失败:', e.message);
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
  rotateLogFile,
  writeLog
};
