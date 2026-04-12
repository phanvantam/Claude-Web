# Claude Web — Giao diện Web cho Claude CLI

Giao diện web hiện đại, mạnh mẽ dành cho [Claude CLI](https://claude.ai/download), cho phép bạn trò chuyện, quản lý dự án và điều khiển AI thực thi các tác vụ lập trình (thay thế Terminal truyền thống).

---

## 📖 Tài liệu hướng dẫn

Vui lòng tham khảo các tài liệu chi tiết sau đây để hiểu rõ hơn về hệ thống:

- **[Tổng quan & Đánh giá (Overview)](docs/overview.md)**: Giới thiệu hệ thống, kiến trúc và đánh giá cấp độ tích hợp hiện tại.
- **[Hướng dẫn Cài đặt & Triển khai (Setup)](docs/setup.md)**: Chi tiết cách thiết lập môi trường Development và Production.
- **[Cấu trúc thư mục (Structure)](docs/overview.md#cấu-trúc-thư-mục)**: Sơ đồ tổ chức các thành phần trong dự án.

---

## ✨ Tính năng nổi bật

- **Quản lý phiên (Session Management)**: Lưu trữ và quản lý lịch sử trò chuyện dài hạn qua ID đồng bộ với Claude CLI.
- **Tương tác công cụ thực tế (Tool Interaction)**: Hỗ trợ đầy đủ việc xin quyền thực thi (`Permission`) và trả lời câu hỏi (`AskUserQuestion`) cho AI.
- **Tiến trình theo dòng thời gian (Timeline UI)**: Hiển thị chi tiết từng bước suy luận (`thinking`) và thực thi công cụ trong một giao diện trực quan.
- **Thiết kế hiện đại (Modern Design)**: Sử dụng các tiêu chuẩn thiết kế mới nhất (Dark mode, Glassmorphism) mang lại trải nghiệm chuyên nghiệp.

---

## 🛠 Bắt đầu nhanh (Quick Start)

Nếu bạn đã có Node.js và Claude CLI, hãy chạy các lệnh sau:

```bash
# Cài đặt
cd backend && npm install
cd ../frontend && npm install

# Chạy môi trường Dev (Dùng 2 Terminal)
# Terminal 1:
cd backend && npm run dev
# Terminal 2:
cd frontend && npm run dev
```

---

## 📜 Giấy phép

ISC License.