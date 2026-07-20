@echo off
setlocal
REM easyagent - one-click launcher (Windows). Double-click to start.
cd /d "%~dp0"

REM Force the user's Claude subscription (an API key would take precedence).
set "ANTHROPIC_API_KEY="
set "ANTHROPIC_AUTH_TOKEN="

REM --- Node.js present? ---
where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo !! Node.js was not found.
  echo    Install it from https://nodejs.org ^(version 20.9 or newer^) and try again.
  goto fail
)

REM --- Node.js recent enough? (Next 16 needs >= 20.9) ---
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>20||(v[0]===20&&v[1]>=9)?0:1)"
if errorlevel 1 (
  echo.
  for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
  echo !! Your Node.js is too old ^(%NODEV%^). easyagent needs 20.9 or newer.
  echo    Update it from https://nodejs.org and try again.
  goto fail
)

if not exist node_modules (
  echo First run: installing dependencies ^(this may take a few minutes^)...
  call npm install
  if errorlevel 1 (
    echo.
    echo !! Dependency installation failed. Check your internet connection and try again.
    goto fail
  )
)

if not exist .next (
  echo Preparing the app ^(first run only^)...
  call npm run build
  if errorlevel 1 (
    echo.
    echo !! App build failed.
    goto fail
  )
)

echo Starting the local server at http://127.0.0.1:3000 ...
start "easyagent server" cmd /c "npx next start -H 127.0.0.1 -p 3000"

echo Waiting for the server to be ready...
for /l %%i in (1,1,60) do (
  curl -s -m 2 http://127.0.0.1:3000/api/config >nul 2>&1 && goto ready
  timeout /t 1 /nobreak >nul
)
:ready
start "" http://127.0.0.1:3000
echo Ready! The app is open in your browser. Close the server window to stop it.
goto end

:fail
echo.
pause
exit /b 1

:end
endlocal
