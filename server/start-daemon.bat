@echo off
chcp 65001 >nul
REM 定位 node（优先使用 WorkBuddy 托管的 node，回退到 PATH 中的 node）
set "NODE=C:\Users\Alan\.workbuddy\binaries\node\versions\24.14.1\node.exe"
if not exist "%NODE%" (
  for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
)
cd /d D:\Clow\projects\smart-customer-service\server
start "广康AI客服守护" /min "%NODE%" daemon.js start
echo 守护进程已启动（后台运行）
