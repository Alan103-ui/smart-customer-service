@echo off
chcp 65001 >nul
echo 正在停止后端...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3001 ^| findstr LISTEN') do taskkill /PID %%a /F >nul 2>&1
timeout /t 2 >nul
echo 正在启动后端...
cd /d D:\Clow\projects\smart-customer-service\server
start "广康集团AI助手后端" /min cmd /c "node index.js > backend.log 2>&1"
echo 后端已启动
