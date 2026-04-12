# Rules for AI Agents (Hướng dẫn cho Agent)

Tài liệu này quy định các quy tắc và tiêu chuẩn bắt buộc khi bất kỳ AI Agent nào làm việc trên dự án **Claude-Web**.

---

## 🌎 Ngôn ngữ và Giao tiếp (Language)

*   **Tiếng Việt**: Tất cả các chú thích (comments), tài liệu (docs), ghi chú và giải thích phải viết bằng tiếng Việt có dấu đầy đủ.
*   **Trực diện**: Trình bày thẳng thắn, không dùng từ ngữ thừa thãi. Nếu thấy giả định của người dùng sai, hãy chỉ ra ngay.

## 🛠 Tiêu chuẩn Kỹ thuật (Technical Standards)

*   **SDK-First**: Ưu tiên sử dụng `@anthropic-ai/claude-agent-sdk` để tương tác với Claude thay vì gọi lệnh CLI thô (spawn).
*   **Duy trì Session**: Luôn đồng bộ `sessionId` với thư mục lưu trữ của Claude CLI (`~/.claude/projects/`). Không được tạo session tùy tiện làm rác máy người dùng.
*   **UI/UX (Level 3 Path)**: 
    *   Mọi Tool Call mới phải được hỗ trợ hiển thị trong `ToolCallCard.tsx`.
    *   Ưu tiên hiển thị trực quan (checklist, table, diff) thay vì hiển thị JSON thô.
    *   Luôn giữ logic xác nhận quyền (`Permission Request`) trước khi thực thi tool xóa/sửa file hoặc chạy lệnh bash.

## 💻 Quy tắc Lập trình (Coding Rules)

*   **Minimalism**: Ưu tiên giải pháp tối giản và chính xác. Tránh over-engineering.
*   **Commenting**: Giải thích **LÝ DO (Why)** chứ không chỉ giải thích code làm gì. Mỗi function phải có mô tả rõ ràng.
*   **WebSocket**: Cẩn trọng với quản lý stream. Luôn có cơ chế `watchdog` hoặc `timeout` để tránh treo tiến trình khi CLI gặp lỗi.

## 🌳 Quy tắc Git & Workflow

*   **Không tự ý tạo nhánh**: Việc tạo nhánh mới (checkout -b) phải được người dùng yêu cầu rõ ràng hoặc xác nhận trước.
*   **Tên nhánh**: Tránh đặt tên nhánh tùy tiện. Tuân thủ quy tắc `feature/`, `fix/`, `refactor/`.
*   **Commit Message**: Viết bằng tiếng Việt hoặc tiếng Anh tùy theo yêu cầu của repo, nhưng phải súc tích.

## ⚠️ Cảnh báo Rủi ro

*   **File Permissions**: Claude Agent chạy trực tiếp trên máy host. Tuyệt đối không thực thi các lệnh bash có tính chất phá hoại (ví dụ: `rm -rf /`) mà không có sự xác nhận rõ ràng của người dùng qua UI.
*   **SQL Schema**: Tránh thay đổi cấu hình database (`database.sqlite`) khi chưa hiểu rõ ảnh hưởng đến lịch sử hội thoại hiện tại.

## 🔍 Hướng dẫn Gỡ lỗi (Debugging)

Khi gặp lỗi (ví dụ: Tool không chạy, mất tin nhắn, treo SDK), Agent cần kiểm tra theo thứ tự:

1.  **Logs**: Mở file log mới nhất trong `backend/logs/claude-YYYY-MM-DD.log`. Tìm các dòng có tiền tố `[ERROR]` hoặc `[SDK]`.
2.  **Database**: Sử dụng SQL để kiểm tra bảng `chat_messages`. Metadata của sub-agent nằm trong cột `blocks`.
3.  **Hội thoại**: Nếu Claude phản hồi sai về Agent, kiểm tra xem file `.md` của Agent đó tại `~/.claude/agents/` có đúng định dạng YAML frontmatter không.

---
*Nếu chưa rõ mục tiêu của task, hãy yêu cầu làm rõ thay vì tự đoán.*
