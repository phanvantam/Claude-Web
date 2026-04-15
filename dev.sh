#!/bin/bash
# dev.sh — Start local development environment (không dùng PM2)
# Chạy: bash dev.sh

set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_DIR="$ROOT_DIR/backend"

echo "======================================"
echo "  Claude Web — Local Dev Start"
echo "======================================"

# ── 1. Install dependencies nếu chưa có ──
echo ""
echo "[1/2] Checking dependencies..."

if [ ! -d "$BACKEND_DIR/node_modules" ]; then
  echo "  Installing backend dependencies..."
  cd "$BACKEND_DIR"
  npm install
else
  echo "  ✅ Backend dependencies OK"
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "  Installing frontend dependencies..."
  cd "$FRONTEND_DIR"
  npm install
else
  echo "  ✅ Frontend dependencies OK"
fi

# ── 2. Start dev servers ──
echo ""
echo "[2/2] Starting dev servers..."
echo ""
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:5173"
echo ""
echo "  Nhấn Ctrl+C để dừng"
echo "======================================"
echo ""

# Trap để cleanup khi Ctrl+C
trap 'echo ""; echo "Stopping..."; kill 0' SIGINT SIGTERM

# Start backend và frontend song song
cd "$BACKEND_DIR" && npm run dev &
cd "$FRONTEND_DIR" && npm run dev &

# Chờ tất cả background processes
wait
