#!/bin/bash
# SnapTick one-time setup for macOS (Apple Silicon)
# Clones the repo to ~/SnapTick-Demo, applies fixes, installs everything,
# and pre-downloads the face-recognition models.

LOG="$HOME/SnapTick-Demo-setup-log.txt"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

APP="$HOME/SnapTick-Demo"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="https://github.com/Dhruvsaini2004/SnapTick.git"
FAILED=0
step() { echo; echo "==================== $1 ===================="; }
fail() { echo "❌ ERROR: $1"; FAILED=1; }

export PATH="/opt/homebrew/bin:$HOME/.homebrew/bin:/usr/local/bin:$PATH"

step "1. Node.js"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
if command -v nvm >/dev/null 2>&1; then
  nvm install 22 >/dev/null 2>&1 && nvm use 22 >/dev/null 2>&1
fi
if command -v node >/dev/null 2>&1; then
  echo "node $(node -v), npm $(npm -v)"
else
  fail "Node.js nahi mila. https://nodejs.org se Node 22 LTS install karo."
fi

step "2. Git"
command -v git >/dev/null 2>&1 && git --version || fail "git nahi mila (xcode-select --install chalao)"

step "3. Python 3.11"
PY=""
for c in python3.11; do
  if command -v $c >/dev/null 2>&1; then PY=$(command -v $c); break; fi
done
if [ -z "$PY" ] && command -v brew >/dev/null 2>&1; then
  echo "Python 3.11 nahi mila, Homebrew se install kar rahe hain..."
  brew install python@3.11 && PY=$(brew --prefix python@3.11)/bin/python3.11
fi
if [ -n "$PY" ]; then echo "Using $PY ($($PY --version))"; else fail "Python 3.11 nahi mila. brew install python@3.11 chalao."; fi

step "4. Clone / update repo -> $APP"
if [ -d "$APP/.git" ]; then
  cd "$APP" && git stash -u >/dev/null 2>&1; git pull --ff-only || fail "git pull failed"
else
  git clone "$REPO" "$APP" || fail "git clone failed"
fi
cd "$APP" || { fail "repo folder missing"; exit 1; }
git log --oneline -1

step "5. Apply fixes"
# canvas 2.x has no prebuilt binary for Node 22 -> use 3.x (same API)
sed -i '' 's/"canvas": "\^2\.11\.2"/"canvas": "^3.2.0"/' Backend/package.json
grep '"canvas"' Backend/package.json

# Face recognition: InsightFace buffalo_l (SCRFD + ArcFace R50) on ONNX Runtime
cat > Backend/deepface_service/requirements.txt <<'EOF2'
flask==3.0.0
insightface==0.7.3
onnxruntime>=1.17
numpy<2
opencv-python
pillow
gunicorn==23.0.0
EOF2
echo "requirements.txt pinned"

# Backend .env: keep existing MONGO_URI, add the rest.
# Port 5050 because macOS AirPlay Receiver already uses port 5000.
ENVF=Backend/.env
touch $ENVF
setkey() { grep -q "^$1=" $ENVF && sed -i '' "s|^$1=.*|$1=$2|" $ENVF || echo "$1=$2" >> $ENVF; }
grep -q "^JWT_SECRET=" $ENVF || echo "JWT_SECRET=$(openssl rand -hex 32)" >> $ENVF
setkey PORT 5050
setkey BASE_URL http://localhost:5050
setkey DEEPFACE_URL http://localhost:5001
setkey ALLOWED_ORIGINS http://localhost:5173,http://127.0.0.1:5173
setkey NODE_ENV development
grep -q "^MONGO_URI=" $ENVF || setkey MONGO_URI mongodb://localhost:27017/snaptick
echo "Backend .env keys: $(sed 's/=.*//' $ENVF | tr '\n' ' ')"
echo "VITE_API_URL=http://localhost:5050" > Frontend/.env
echo "Frontend .env -> http://localhost:5050"

step "6. Backend npm install"
(cd Backend && npm install) || fail "Backend npm install failed"
(cd Backend && node -e "require('canvas'); console.log('canvas OK')") || fail "canvas load failed"

step "7. Frontend npm install + build check"
(cd Frontend && npm install) || fail "Frontend npm install failed"
(cd Frontend && npm run build >/dev/null 2>&1 && echo "Frontend build OK") || fail "Frontend build failed"

step "8. MongoDB connection test"
(cd Backend && node -e "
require('dotenv').config();
require('mongoose').connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:15000})
 .then(()=>{console.log('MongoDB CONNECTED OK');process.exit(0)})
 .catch(e=>{console.log('MongoDB FAILED: '+e.message);process.exit(1)})") || fail "MongoDB connect failed (Atlas Network Access mein 0.0.0.0/0 add karo)"

step "9. Python venv + face recognition install (time lagega)"
cd "$APP/Backend/deepface_service"
if [ -n "$PY" ]; then
  rm -rf venv
  "$PY" -m venv venv && source venv/bin/activate
  pip install --upgrade pip >/dev/null
  pip install -r requirements.txt || fail "pip install failed"

  step "10. Download face models (InsightFace buffalo_l, ~280 MB)"
  python -c "
from insightface.app import FaceAnalysis
app = FaceAnalysis(name='buffalo_l', allowed_modules=['detection','recognition'], providers=['CPUExecutionProvider'])
app.prepare(ctx_id=-1, det_size=(640,640))
print('MODELS READY')" || fail "model download failed"
  deactivate
fi

step "11. Start script"
cp "$SCRIPT_DIR/SnapTick-Start.command" "$SCRIPT_DIR/SnapTick-Setup.command" "$APP/" 2>/dev/null
chmod +x "$APP/SnapTick-Start.command" 2>/dev/null
ls -l "$APP/SnapTick-Start.command"

echo
if [ $FAILED -eq 0 ]; then echo "✅✅✅ SETUP COMPLETE — ab SnapTick-Start.command chalao"; else echo "⚠️ SETUP FINISHED WITH ERRORS — upar ❌ dekho"; fi
echo "SETUP_DONE"
