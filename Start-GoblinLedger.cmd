@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 26.13.1 LTS first. & pause & exit /b 1)
if not exist "dist\index.html" (echo Run Setup-GoblinLedger.cmd in this folder first. & pause & exit /b 1)
if not exist "node_modules\fastify\package.json" (echo Run Setup-GoblinLedger.cmd in this folder first. & pause & exit /b 1)
node apps\local\start.mjs
if errorlevel 1 (pause & exit /b 1)
exit /b 0
