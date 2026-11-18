@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 26.13.1 LTS, then run setup again. & pause & exit /b 1)
call npm.cmd exec --yes --package=pnpm@10.26.2 -- pnpm install --frozen-lockfile
if errorlevel 1 goto failed
call node_modules\.bin\vite.cmd build apps/web --outDir ../../dist --emptyOutDir
if errorlevel 1 goto failed
echo Ready. Run Start-GoblinLedger.cmd.
exit /b 0
:failed
echo Setup failed. See the error above.
pause
exit /b 1
