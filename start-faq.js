// start-faq.js - 广康集团AI助手 启动脚本（Node.js版）
// 用法：node start-faq.js   （start-faq.bat 会调用这个文件）

const { execSync, spawn } = require('child_process');
const fs   = require('fs');
const net  = require('net');
const path = require('path');

const PORT = 3001;
const DIR  = 'D:\\Clow\\projects\\smart-customer-service';
const LOG  = path.join(DIR, 'server.log');

function log(msg) { process.stdout.write(msg + '\n'); }

// 执行命令（同步，返回 stdout）
function run(cmd, { silent = true, ignoreErr = false } = {}) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', shell: 'cmd.exe', stdio: silent ? 'pipe' : 'inherit' });
    return (out || '').trim();
  } catch (e) {
    if (!ignoreErr) throw e;
    return '';
  }
}

// 检查端口是否被占用（用 Node net 代替 netstat，更可靠）
function checkPort(cb) {
  const s = net.connect(PORT, '127.0.0.1', () => { s.destroy(); cb(true); });
  s.on('error', () => cb(false));
}

// sleep
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 等待用户按键
function waitKey() {
  return new Promise(r => {
    process.stdout.write('\n按回车键继续...');
    process.stdin.once('data', () => r());
  });
}

// ===== 主流程 =====
(async () => {
  log('======================================');
  log('    广康集团AI助手 - 启动脚本');
  log('======================================');
  log('');

  // 0. 检查 Node.js
  log('[0/3] 检查 Node.js...');
  try {
    const v = run('node --version', { silent: true });
    log('[OK] Node.js ' + v);
  } catch (e) {
    log('[ERROR] 找不到 node！请安装 Node.js 并添加到 PATH。');
    await waitKey();
    process.exit(1);
  }

  // 1. 释放端口 3001
  log('[1/3] 释放端口 ' + PORT + '...');
  // 用 net 模块检查端口
  await new Promise(r => {
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.destroy();
      // 端口被占用，杀掉 node 进程
      log('  端口被占用，正在停止 node 进程...');
      run('taskkill /IM node.exe /F', { ignoreErr: true });
      setTimeout(r, 1500);
    });
    s.on('error', () => { s.destroy(); r(); }); // 端口空闲
  });
  log('[OK] 端口 ' + PORT + ' 已释放');

  // 2. 检查后端文件
  log('[2/3] 检查后端文件...');
  const serverJs = path.join(DIR, 'server', 'index.js');
  if (!fs.existsSync(serverJs)) {
    log('[ERROR] 找不到：' + serverJs);
    await waitKey();
    process.exit(1);
  }
  log('[OK] 后端文件存在');

  // 3. 启动后端
  log('[3/3] 启动后端...');
  const logStream = fs.openSync(LOG, 'a');
  const child = spawn('node', ['server/index.js'], {
    cwd: DIR,
    detached: true,
    stdio: ['ignore', logStream, logStream],
  });
  child.unref();
  log('[OK] 后端已启动（PID: ' + child.pid + '）');
  log('      日志文件：' + LOG);

  // 4. 等待后端启动（最多 30 秒）
  log('');
  log('等待后端启动（最多 30 秒）...');
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const up = await new Promise(r => {
      const s = net.connect(PORT, '127.0.0.1', () => { s.destroy(); r(true); });
      s.on('error', () => { s.destroy(); r(false); });
    });
    if (up) {
      log('');
      log('========== 启动成功！==========');
      log('  管理后台：http://localhost:' + PORT + '/admin');
      log('  用户聊天：http://localhost:' + PORT + '/');
      log('======================================');
      log('');
      await waitKey();
      process.exit(0);
    }
    log('  等待中...（' + (i + 1) + '/15）');
  }

  log('');
  log('[ERROR] 启动超时！请检查日志文件：');
  log('  ' + LOG);
  log('');
  await waitKey();
  process.exit(1);
})().catch(e => {
  log('');
  log('[ERROR] 启动脚本异常：' + e.message);
  process.exit(1);
});
