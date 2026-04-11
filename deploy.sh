#!/bin/bash
# deploy.sh — Build và restart production Claude Web
# Chạy trên server: bash deploy.sh

set -e  # Dừng ngay nếu có lệnh fail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

echo "======================================"
echo "  Claude Web — Deploy Production"
echo "======================================"

# ── 1. Pull code mới nhất ──
echo ""
echo "[1/5] Pulling latest code..."
git -C "$ROOT_DIR" pull

# ── 2. Cài dependencies frontend ──
echo ""
echo "[2/5] Installing frontend dependencies..."
cd "$FRONTEND_DIR"
npm install --prefer-offline

# ── 3. Xóa cache và build frontend ──
echo ""
echo "[3/5] Building frontend (clearing cache)..."
# Xóa build cũ + Vite cache
rm -rf "$FRONTEND_DIR/dist"
rm -rf "$FRONTEND_DIR/node_modules/.vite"
npm run build

echo "  ✅ Frontend built: $FRONTEND_DIR/dist"

# ── 4. Cài dependencies backend ──
echo ""
echo "[4/5] Installing backend dependencies..."
cd "$BACKEND_DIR"
npm install --prefer-offline

# ── 5. Restart PM2 ──
echo ""
echo "[5/5] Restarting PM2..."
# Nếu app chưa tồn tại trong PM2 → start mới; nếu có → reload
if pm2 describe claude-web > /dev/null 2>&1; then
  pm2 reload claude-web --update-env
else
  echo "  ⚠️  PM2 app 'claude-web' không tồn tại. Kiểm tra tên app trong: pm2 list"
  echo "  Chạy thủ công: pm2 restart <tên-app>"
fi

pm2 save

echo ""
echo "======================================"
echo "  ✅ Deploy hoàn tất!"
echo "======================================"
pm2 status
