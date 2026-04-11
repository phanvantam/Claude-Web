# Claude Web — Giao diện Web cho Claude CLI

Giao diện web hiện đại, mạnh mẽ dành cho [Claude CLI](https://claude.ai/download), cho phép bạn trò chuyện, quản lý dự án và điều khiển AI thực thi các tác vụ lập trình (thay thế Terminal truyền thống).

## ✨ Tính năng nổi bật

- **Quản lý phiên (Session Management)**: Lưu trữ và quản lý lịch sử trò chuyện.
- **Tiến trình Sub-Agent**: Hiển thị chi tiết từng bước thực thi của Sub-Agent trong timeline.
- **Tương tác công cụ**: Hỗ trợ đầy đủ các tính năng `AskUserQuestion` và xin quyền thực thi công cụ.
- **Tùy chỉnh linh hoạt**: Hỗ trợ chọn Model, mức độ Nỗ lực (Effort) và Chế độ cấp quyền (Permission) cho từng phiên.
- **Thiết kế hiện đại**: UI thân thiện, tối ưu cho lập trình viên.

## 🛠 Yêu cầu hệ thống

- **Node.js**: Phiên bản 18 trở lên.
- **Claude CLI**: Đã được cài đặt và đăng nhập trên máy (kiểm tra bằng lệnh `claude --version`).

## 🚀 Hướng dẫn Development

Để bắt đầu phát triển ứng dụng ở môi trường local:

### 1. Cài đặt Dependencies

Chạy lệnh cài đặt cho cả backend và frontend:

```bash
# Cài đặt cho backend
cd backend
npm install

# Cài đặt cho frontend
cd ../frontend
npm install
```

### 2. Chạy môi trường Dev

Bạn cần chạy song song hai terminal:

- **Terminal 1 (Backend)**: 
  ```bash
  cd backend
  npm run dev
  ```
  Backend sẽ chạy mặc định tại: `http://localhost:3001`

- **Terminal 2 (Frontend)**:
  ```bash
  cd frontend
  npm run dev
  ```
  Frontend (Vite) sẽ chạy mặc định tại: `http://localhost:5173` (được cấu hình proxy sang backend 3001).

---

## 🏗 Hướng dẫn Deploy Production

Để triển khai ứng dụng cho mục đích sử dụng thực tế (Production):

### 1. Build Frontend

Chuyển vào thư mục `frontend` và build file tĩnh:

```bash
cd frontend
npm run build
```
Kết quả build sẽ nằm trong thư mục `frontend/dist`.

### 2. Chuẩn bị Backend

Trên server, sau khi `git pull`, **bắt buộc** phải cài đặt lại dependencies để native module được build đúng cho hệ điều hành của server:

```bash
cd /var/www/Claude-Web/backend
npm install

cd /var/www/Claude-Web/frontend
npm install
```

> **Lưu ý**: `node_modules/` không được push lên Git. Gói `better-sqlite3` là native module (C++ addon) — phải được build trực tiếp trên server (Linux), không thể dùng binary đã build sẵn trên macOS.

### 3. Khởi chạy Server

Bạn có thể chạy server trực tiếp bằng lệnh:

```bash
# Trong thư mục backend
PORT=3001 npm start
```

# Sử dụng PM2 để quản lý process (Khuyến nghị cho Production)
PORT=3001 CLAUDE_BIN_PATH=/path/to/claude pm2 start "npm start" --name "claude-web" --cwd ./backend

Sau khi chạy, truy cập `http://localhost:3001` để bắt đầu sử dụng. Toàn bộ ứng dụng (cả front và back) sẽ được phục vụ chung trên một cổng duy nhất.

## 📁 Cấu trúc thư mục

- `frontend/`: Ứng dụng React (Vite, Ant Design, Monaco Editor).
- `backend/`: Server Node.js (Express, Socket.id, SQLite).
- `backend/data/`: Thư mục lưu trữ database SQLite.
- `~/.claude/projects/`: Thư mục chứa log CLI và metadata sub-agents.

## 📜 Giấy phép

ISC License.