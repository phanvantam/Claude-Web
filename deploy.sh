#!/bin/bash
# deploy.sh — Build và restart production Claude Web
# Chạy trên server: bash deploy.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"
BUILD_VERSION=$(date +%Y%m%d_%H%M%S)

echo "======================================"
echo "  Claude Web — Deploy $BUILD_VERSION"
echo "======================================"

# ── 1. Pull code mới nhất ──
echo ""
echo "[1/6] Pulling latest code..."
git -C "$ROOT_DIR" pull

# ── 2. Frontend dependencies ──
echo ""
echo "[2/6] Installing frontend dependencies..."
cd "$FRONTEND_DIR"
npm install --prefer-offline

# ── 3. Xóa cache + build frontend với version ──
echo ""
echo "[3/6] Building frontend (version: $BUILD_VERSION)..."
rm -rf "$FRONTEND_DIR/dist"
rm -rf "$FRONTEND_DIR/node_modules/.vite"
VITE_BUILD_VERSION="$BUILD_VERSION" npm run build
echo "  ✅ Frontend built"

# ── 4. Backend dependencies ──
echo ""
echo "[4/6] Installing backend dependencies..."
cd "$BACKEND_DIR"
npm install --prefer-offline
npm run build

# ── 5. Xóa nginx proxy cache (nếu có) ──
echo ""
echo "[5/6] Clearing nginx cache..."
if [ -d "/www/wwwroot/claude.tampv.com/proxy_cache_dir" ]; then
  rm -rf /www/wwwroot/claude.tampv.com/proxy_cache_dir/*
  echo "  ✅ Nginx proxy cache cleared"
else
  echo "  ℹ️  No proxy cache dir found, skipping"
fi
# Reload nginx để xóa cache trong memory
nginx -t && nginx -s reload 2>/dev/null && echo "  ✅ Nginx reloaded" || echo "  ⚠️  Nginx reload skipped"

# ── 6. Restart PM2 ──
echo ""
echo "[6/6] Restarting PM2..."
# Tìm tên app PM2 có chứa "claude"
PM2_APP=$(pm2 jlist 2>/dev/null | grep -o '"name":"[^"]*claude[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$PM2_APP" ]; then
  echo "  Found PM2 app: $PM2_APP"
  pm2 reload "$PM2_APP" --update-env
else
  echo "  ⚠️  Không tìm thấy PM2 app chứa 'claude'. Các app hiện có:"
  pm2 list
  echo "  Chạy thủ công: pm2 restart <tên-app>"
fi
pm2 save 2>/dev/null || true

echo ""
echo "======================================"
echo "  ✅ Deploy $BUILD_VERSION hoàn tất!"
echo "  🔍 Verify: mở console browser → tìm '[Claude Web] Build: ...'"
echo "======================================"
