@echo off
chcp 65001 >nul
cd /d D:\Clow\projects\smart-customer-service\server
set LOG_FILE=D:\Clow\projects\smart-customer-service\server\backend.log
echo [%date% %time%] 启动广康集团AI助手后端... >> "%LOG_FILE%"
node index.js >> "%LOG_FILE%" 2>&1
