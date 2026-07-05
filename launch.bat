@echo off
REM easyclaude - one-click launcher (Windows). Double-click to start.
cd /d "%~dp0"

REM Force the user's Claude subscription (an API key would take precedence).
set "ANTHROPIC_API_KEY="
set "ANTHROPIC_AUTH_TOKEN="

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install
)
if not exist .next (
  echo Preparing the app...
  call npm run build
)

echo Starting the local server at http://127.0.0.1:3000 ...
start "easyclaude server" cmd /c "npx next start -H 127.0.0.1 -p 3000"

echo Waiting for the server to be ready...
for /l %%i in (1,1,30) do (
  curl -s -m 2 http://127.0.0.1:3000/api/config >nul 2>&1 && goto ready
  timeout /t 1 /nobreak >nul
)
:ready
start "" http://127.0.0.1:3000
echo Ready! The app is open in your browser. Close the server window to stop it.
