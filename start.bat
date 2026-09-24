@echo off
rem Casa Artis Calendar v2 - start on Windows.
rem Edit the values below (or create a .env file and use a service wrapper such as NSSM).
cd /d "%~dp0"
if "%APP_URL%"=="" set APP_URL=http://localhost:3000
if "%PORT%"=="" set PORT=3000
if "%NODE_ENV%"=="" set NODE_ENV=production
if not exist node_modules (
  echo Installing dependencies...
  call npm ci --omit=dev || goto :error
)
node server\index.js
goto :eof
:error
echo Installation failed.
pause
