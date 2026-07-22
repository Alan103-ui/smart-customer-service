#!/usr/bin/env node
'use strict';
/**
 * 广康AI智能客服 - 进程守护（零依赖）
 *
 * 守护 node index.js（端口 3001）。特性：
 *  - 崩溃 / 异常退出自动重启
 *  - 单实例锁（.daemon.pid），避免重复启动
 *  - 子进程 stdout/stderr 转发到 logs/daemon.log（带时间戳）
 *  - start / stop / status 子命令
 *  - 收到 SIGINT / SIGTERM 时优雅关闭子进程并清理 pid 文件
 *
 * 用法（在 server/ 目录下）：
 *   node daemon.js           启动（前台，阻塞）
 *   node daemon.js start     启动（前台）
 *   node daemon.js stop      停止守护（向守护进程发 SIGTERM）
 *   node daemon.js status    查看守护进程与端口 3001 状态
 */

const fs = require('fs');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const SERVER_DIR = __dirname;
const PID_FILE = path.join(SERVER_DIR, '.daemon.pid');
const LOG_DIR = path.join(SERVER_DIR, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'daemon.log');
const MAIN_PORT = 3001;
const RESTART_DELAY = 1500;

fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

// 守护自身消息：同时写文件与 stdout
function log(prefix, msg) {
  const line = `[${ts()}] [${prefix}] ${msg}\n`;
  logStream.write(line);
  process.stdout.write(line);
}

// 子进程输出：仅写文件（避免刷屏）
function logChild(prefix, chunk) {
  const text = chunk.toString();
  text.split(/\r?\n/).forEach((line) => {
    if (line.length) logStream.write(`[${ts()}] [${prefix}] ${line}\n`);
  });
}

function readPid() {
  try {
    return parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
  } catch (e) {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function writePid(pid) {
  fs.writeFileSync(PID_FILE, String(pid));
}

function removePid() {
  try {
    fs.unlinkSync(PID_FILE);
  } catch (e) {
    /* ignore */
  }
}

function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(1500);
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => {
      sock.destroy();
      resolve(false);
    });
    sock.once('timeout', () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, host);
  });
}

let child = null;
let stopping = false;

function startChild() {
  if (stopping) return;
  log('daemon', `启动子进程: ${path.basename(process.execPath)} index.js`);
  child = spawn(process.execPath, ['index.js'], {
    cwd: SERVER_DIR,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => logChild('index', d));
  child.stderr.on('data', (d) => logChild('index', d));
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    log('daemon', `子进程退出 code=${code} signal=${signal}，将在 ${RESTART_DELAY}ms 后重启`);
    setTimeout(startChild, RESTART_DELAY);
  });
}

function gracefulShutdown() {
  if (stopping) return;
  stopping = true;
  log('daemon', '收到停止信号，正在关闭子进程...');
  if (child) {
    try {
      child.kill('SIGTERM');
    } catch (e) {
      /* ignore */
    }
    // 兜底强杀
    setTimeout(() => {
      if (child) {
        try {
          child.kill('SIGKILL');
        } catch (e) {
          /* ignore */
        }
      }
    }, 3000);
  }
  removePid();
  setTimeout(() => {
    try {
      logStream.end();
    } catch (e) {
      /* ignore */
    }
    process.exit(0);
  }, 500);
}

function doStart() {
  const pid = readPid();
  if (pidAlive(pid)) {
    log('daemon', `守护进程已在运行 (pid=${pid})，退出`);
    process.exit(0);
  }
  writePid(process.pid);
  log('daemon', `守护进程启动 pid=${process.pid}，监听端口 ${MAIN_PORT}`);
  startChild();
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  // 保持事件循环（因 child 存在而保持）
}

async function doStop() {
  const pid = readPid();
  if (!pidAlive(pid)) {
    log('daemon', '守护进程未运行');
    removePid();
    process.exit(0);
  }
  log('daemon', `发送停止信号给守护进程 pid=${pid}`);
  try {
    process.kill(pid, 'SIGTERM');
  } catch (e) {
    log('daemon', 'kill 失败: ' + e.message);
  }
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (!pidAlive(pid)) break;
  }
  if (pidAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (e) {
      /* ignore */
    }
  }
  removePid();
  log('daemon', '已停止');
  process.exit(0);
}

async function doStatus() {
  const pid = readPid();
  const alive = pidAlive(pid);
  const port = await checkPort(MAIN_PORT);
  console.log('=== 广康AI客服 守护状态 ===');
  console.log(`守护进程: ${alive ? '运行中 (pid=' + pid + ')' : '未运行'}`);
  console.log(`端口 ${MAIN_PORT}: ${port ? '监听中 ✅' : '未监听 ❌'}`);
  if (alive && !port) console.log('⚠️ 守护进程在运行，但服务尚未就绪（可能正在启动 / 重启中）');
  if (!alive && port) console.log('ℹ️ 端口被其它进程占用（非本守护管理）');
  process.exit(0);
}

const cmd = process.argv[2] || 'start';
if (cmd === 'stop') {
  doStop();
} else if (cmd === 'status') {
  doStatus();
} else if (cmd === 'start') {
  doStart();
} else {
  console.log('用法: node daemon.js [start|stop|status]');
  process.exit(1);
}
