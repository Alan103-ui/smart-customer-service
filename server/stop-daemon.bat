@echo off
chcp 65001 >nul
REM 定位 node
set "NODE=C:\Users\Alan\.workbuddy\binaries\node\versions\24.14.1\node.exe"
if not exist "%NODE%" (
  for /f "delims=" %%i in ('where node 2^>nul') do set "NODE=%%i"
)
cd /d D:\Clow\projects\smart-customer-service\server
"%NODE%" daemon.js stop
