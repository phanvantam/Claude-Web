# Tổng quan Hệ thống (System Overview)

Tài liệu này cung cấp cái nhìn tổng quát về kiến trúc, mục tiêu và trạng thái hiện tại của dự án Claude Web.

---

## 🎯 Mục tiêu và Triết lý Dự án (Philosophy)

Claude Web được xây dựng không phải để thay thế hay làm lại bộ não của Claude, mà là một **Giao diện Web nâng cao** cho [Claude CLI](https://claude.ai/download).

**Triết lý cốt lõi:**
*   **Web-First UI**: Chỉ tập trung vào việc hiển thị trực quan và tương tác người dùng.
*   **SDK-Max**: Tận dụng tối đa sự thông minh, khả năng lập kế hoạch (planning) và tối ưu hóa của `@anthropic-ai/claude-agent-sdk`.
*   **Zero Redundancy**: Tuyệt đối không làm lại, không xử lý lại bất kỳ logic nào mà Claude Code hoặc SDK đã hỗ trợ mặc định (ví dụ: vòng lặp tool, quản lý context, retry).

## 🏗 Kiến trúc Cơ bản

Hệ thống được xây dựng theo mô hình Client-Server với các thành phần chính:

1.  **Frontend (React/Vite)**: 
    *   Sử dụng **Ant Design** làm thư viện UI chính.
    *   Giao diện chat dạng **Timeline**, phân biệt rõ ràng các bước suy luận (`thinking`), thực thi công cụ (`tool_use`), và kết quả sub-agent.
    *   Tích hợp trình soạn thảo code (Monaco Editor) để xem xét văn bản/code.
2.  **Backend (Node.js/Express)**: 
    *   Tích hợp trực tiếp với **@anthropic-ai/claude-agent-sdk** (đây là thành phần quan trọng nhất để điều khiển Claude theo cách lập trình). Xem chi tiết tại [Tiêu chuẩn SDK](file:///Users/tampv/Projects/Claude-Web/docs/sdk-standards.md).
    *   Sử dụng **WebSocket (Socket.io)** để stream message và yêu cầu quyền hệ thống theo thời gian thực.
    *   Lưu trữ lịch sử phiên làm việc trong database **SQLite**.
3.  **Claude CLI Connectivity**: 
    *   Backend giao tiếp với Claude CLI thông qua SDK để thực thi các tool hệ thống (Bash, Edit, Read...).
    *   Duy trì sự đồng bộ về session ID với file history trong `~/.claude/projects/`.

---

## 🥉 Đánh giá Trạng thái Tận dụng (Evolution Levels)

Dựa trên đề xuất về 3 cấp độ tích hợp, đây là đánh giá hiện tại của hệ thống:

### Hiện trạng: **Level 2.5 (Tiệm cận Level 3)**

Hệ thống đã chuyển đổi hoàn toàn sang dùng **Claude Agent SDK**, mang lại khả năng kiểm soát mạnh mẽ hơn nhiều so với việc chỉ parsing CLI thô.

#### ✅ Những gì đã đạt được (Level 3):
*   **Tool Interaction & Approval**: Đã có UI xác nhận quyền (`Allow`/`Deny`) và bảng hỏi đáp (`AskUserQuestion`).
*   **Reasoning Visibility**: Bắt được block `thinking` và hiển thị trực quan tiến trình suy nghĩ của AI.
*   **Long-lived Sessions**: Quản lý session thông minh, cho phép ngắt quãng và tiếp tục (resume) các phiên làm việc dài lên tới hàng trăm lượt nhắn.
*   **Interactive UI**: Xử lý các tool đặc biệt như `TodoWrite` thành checklist tương tác thay vì text JSON thô.

#### 🛠 Những gì còn thiếu (Để đạt Level 3 "Premium"):
*   **Visual Diff**: Khi Claude sửa file (`Edit`/`Write`), kết quả hiện tại vẫn là văn bản/JSON. Cần nâng cấp lên giao diện so sánh code (Diff view) trực quan.
*   **Full Agent Control**: Tối ưu hóa việc hiển thị các luồng xử lý song song hoặc lồng cấu của sub-agents (Agent loop).

---

## 📁 Cấu trúc Thư mục

- `frontend/`: Ứng dụng React (Vite, Ant Design, Monaco Editor).
- `backend/`: Server Node.js (Express, Socket.io, SQLite).
- `backend/data/`: Database SQLite.
- `docs/`: Tài liệu chi tiết về hệ thống.

---

## 💾 Hệ thống Lưu trữ & Nhật ký (Storage & Logging)

Để phục vụ việc vận hành và gỡ lỗi, hệ thống duy trì hai nguồn dữ liệu chính:

### 1. Cơ sở dữ liệu (SQLite)
*   **Vị trí**: `backend/data/database.sqlite`
*   **Bảng Chat Messages**: Cột `blocks` lưu trữ toàn bộ cấu trúc tin nhắn (text, tool_use, subagent_result) dưới dạng JSON. Đây là nơi quan trọng nhất để kiểm tra metadata của các Agent.
*   **Session Management**: Session ID được đồng bộ 1:1 với thư mục dự án của Claude Code CLI để đảm bảo lịch sử hội thoại nhất quán.

### 2. Nhật ký Hệ thống (Logs)
*   **Vị trí**: `backend/logs/claude-YYYY-MM-DD.log`
*   **Cơ chế**: Tự động xoay vòng (rotate) theo ngày và ghi song song ra Console.
*   **Nội dung**: Ghi lại chi tiết quá trình khởi tạo SDK, thực thi tool, và các sự kiện luồng (streaming events). Khi hệ thống có lỗi "Processing..." kéo dài, hãy kiểm tra file log này trước tiên.
