#!/usr/bin/env bash
# easyagent - one-click launcher (macOS / Linux).
# Builds if needed, forces subscription auth, starts the local server, opens the browser.
# Note: deliberately ASCII-only and NOT using `set -u` -- the stock macOS bash 3.2
# mis-parses non-ASCII bytes next to "$VAR", which broke earlier versions.

pause_and_exit() {
  echo ""
  read -r -p "Press Enter to close this window." _ 2>/dev/null || true
  exit "${1:-1}"
}

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${APP_DIR}" || { echo "App folder not found."; pause_and_exit 1; }

# Make common tool locations reachable when launched from Finder (minimal PATH).
export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# Force the user's Claude subscription (an API key would take precedence).
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN 2>/dev/null

HOST="127.0.0.1"
PORT="${PORT:-3000}"
URL="http://${HOST}:${PORT}"

open_browser() {
  if command -v open >/dev/null 2>&1; then open "${URL}"
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "${URL}"
  else echo "Open this in your browser: ${URL}"; fi
}

echo "> easyagent - starting..."

if ! command -v npm >/dev/null 2>&1; then
  echo "!! Node.js not found. Install it from https://nodejs.org and try again."
  pause_and_exit 1
fi

# Next 16 needs Node >= 20.9. Let node itself do the semver comparison.
if ! node -e 'var v=process.versions.node.split(".").map(Number);process.exit(v[0]>20||(v[0]===20&&v[1]>=9)?0:1)' 2>/dev/null; then
  echo "!! Your Node.js is too old ($(node -v 2>/dev/null)). easyagent needs 20.9 or newer."
  echo "   Update it from https://nodejs.org and try again."
  pause_and_exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "> Installing dependencies (this may take a few minutes)..."
  npm install --no-fund --no-audit || { echo "!! Dependency installation failed."; pause_and_exit 1; }
  # Stamp the folder so an unchanged package.json never reinstalls again.
  touch node_modules
fi

# Rebuild when there is no build yet OR the code is newer than the build
# (e.g. after a git pull) -- a stale build silently hides new features.
NEED_BUILD=0
if [ ! -d .next ] || [ ! -f .next/BUILD_ID ]; then
  NEED_BUILD=1
elif [ -d .git ] && [ "$(git -C "${APP_DIR}" log -1 --format=%ct 2>/dev/null || echo 0)" -gt "$(stat -f %m .next/BUILD_ID 2>/dev/null || stat -c %Y .next/BUILD_ID 2>/dev/null || echo 0)" ]; then
  NEED_BUILD=1
fi
if [ "${NEED_BUILD}" = "1" ]; then
  echo "> Preparing the app (first run or after an update)..."
  npm run build || { echo "!! App build failed."; pause_and_exit 1; }
fi

# Already serving? Just open the browser.
if curl -s -m 2 "${URL}/api/config" >/dev/null 2>&1; then
  echo "> easyagent is already running."
  open_browser
  exit 0
fi

echo "> Starting the local server at ${URL} ..."
npx next start -H "${HOST}" -p "${PORT}" &
SERVER_PID=$!

echo "> Waiting for the server to be ready..."
i=0
while [ "${i}" -lt 60 ]; do
  if curl -s -m 2 "${URL}/api/config" >/dev/null 2>&1; then break; fi
  sleep 0.5
  i=$((i + 1))
done

open_browser
echo "> Ready! The app is open in your browser."
echo "  Close this window (or press Ctrl+C) to stop easyagent."

trap 'kill "${SERVER_PID}" 2>/dev/null' EXIT INT TERM
wait "${SERVER_PID}"
