#!/bin/bash
# SnapTick: start DeepFace (5001), Backend (5050), Frontend (5173) and open the app.
# Close this Terminal window (or press Ctrl+C) to stop everything.

APP="$HOME/SnapTick-Demo"
cd "$APP" || { echo "SnapTick folder not found at $APP"; read; exit 1; }
mkdir -p logs
export PATH="/opt/homebrew/bin:$HOME/.homebrew/bin:/usr/local/bin:$PATH"
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 22 >/dev/null 2>&1

# Free the ports in case an old run is still alive
for p in 5001 5050 5173; do lsof -ti tcp:$p | xargs kill -9 2>/dev/null; done

PIDS=()
cleanup() { echo; echo "Stopping SnapTick..."; kill "${PIDS[@]}" 2>/dev/null; exit 0; }
trap cleanup INT TERM HUP EXIT

wait_for() { # url seconds name
  for i in $(seq 1 $2); do curl -s -o /dev/null "$1" && { echo "✅ $3 ready"; return 0; }; sleep 1; done
  echo "❌ $3 did not start — check logs/$4"; return 1
}

echo "Starting MongoDB (local)..."
brew services start mongodb-community >/dev/null 2>&1
for i in $(seq 1 30); do nc -z localhost 27017 2>/dev/null && { echo "✅ MongoDB (27017) ready"; break; }; sleep 1; done
nc -z localhost 27017 2>/dev/null || echo "❌ MongoDB did not start — run: brew services restart mongodb-community"

echo "Starting face recognition service (InsightFace, ~20s)..."
(cd Backend/deepface_service && source venv/bin/activate && exec python app.py) > logs/deepface.log 2>&1 &
PIDS+=($!)
wait_for http://localhost:5001/health 240 "Face AI (5001)" deepface.log

echo "Starting Backend..."
(cd Backend && exec node server.js) > logs/backend.log 2>&1 &
PIDS+=($!)
wait_for http://localhost:5050 60 "Backend (5050)" backend.log
grep -E "MongoDB" logs/backend.log

echo "Starting Frontend..."
(cd Frontend && exec npm run dev -- --port 5173 --strictPort) > logs/frontend.log 2>&1 &
PIDS+=($!)
wait_for http://localhost:5173 60 "Frontend (5173)" frontend.log

open http://localhost:5173
echo
echo "🎉 SnapTick running at http://localhost:5173"
echo "   Logs: $APP/logs   |   Stop: close this window or press Ctrl+C"
wait
