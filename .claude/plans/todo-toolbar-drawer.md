# Mục tiêu

Thêm nút `Todo` vào toolbar của chat input để mở một drawer tổng hợp toàn bộ task từ các lần gọi tool `TodoWrite` trong session, giúp theo dõi tiến độ xử lý thuận tiện hơn.

# Phân tích hiện trạng

- `TodoWrite` hiện chỉ được hiển thị trong timeline qua `TodoChecklist` bên trong `frontend/src/components/Chat/ToolCallCard.tsx`.
- Toolbar của input box hiện có các nút Model, Effort, Permission, Agent; chưa có entry cho todo tracking.
- `frontend/src/pages/ChatPage.tsx` là nơi đang giữ `messages`, phù hợp để trích xuất todo từ các tool call và truyền xuống UI con.
- Codebase đã có pattern drawer tái sử dụng ở các component như `SubAgentDrawer` và `PlanDrawer`, gồm responsive width và dark theme styles trong `frontend/src/styles/drawers.css`.
- `frontend/src/components/Chat/InputBox/types.ts` đang là nơi định nghĩa props cho `InputBox`, nên cần mở rộng để nhận trạng thái todo.

# Các bước thực hiện

1. **Tạo `TodoDrawer` mới** tại `frontend/src/components/Chat/TodoDrawer.tsx`.
   - Dùng pattern từ các drawer hiện có.
   - Nhận `open`, `onClose`, `todos`.
   - Group danh sách theo thứ tự `in_progress` → `pending` → `completed`.
   - Hiển thị empty state nếu chưa có todo.
   - Hiển thị badge/count cho số todo chưa hoàn thành.

2. **Mở rộng `InputBox`**.
   - Thêm prop `hasIncompleteTodos?: boolean` trong `frontend/src/components/Chat/InputBox/types.ts`.
   - Trong `frontend/src/components/Chat/InputBox.tsx`, thêm nút `Todo` vào toolbar với icon `CheckSquareOutlined`.
   - Nút dùng active styling khi còn todo chưa hoàn thành.
   - Quản lý local state để mở/đóng `TodoDrawer` và render drawer từ chính `InputBox`.

3. **Trích xuất todo từ messages trong `ChatPage`**.
   - Dùng `useMemo` để duyệt các `tool_use` block có `tool.name === 'TodoWrite'`.
   - Gộp `tool.input.todos` thành một mảng truyền xuống `InputBox`.
   - Truyền cả `todos` và `hasIncompleteTodos` để toolbar phản ánh đúng trạng thái session.

4. **Bổ sung style drawer** trong `frontend/src/styles/drawers.css`.
   - Thêm class cho phần header, badge, section title, empty state nếu cần.
   - Tái sử dụng tối đa các class todo checklist đã có để tránh duplicate styling.

5. **Xác minh thay đổi**.
   - Build frontend để chắc chắn TypeScript và bundling đều pass.
   - Kiểm tra UI flow: nút hiện trên toolbar, drawer mở được, dữ liệu todo render đúng, trạng thái active đúng khi còn task chưa hoàn thành.

# Rủi ro

- Dữ liệu todo có thể xuất hiện nhiều snapshot theo thời gian; nếu chỉ concat toàn bộ thì drawer sẽ hiển thị trùng các version của cùng task. Khi implement cần đọc cấu trúc message hiện tại để quyết định giữ tất cả snapshot hay chỉ lấy snapshot mới nhất cho mỗi lần `TodoWrite`.
- `InputBox` đang là component có nhiều logic toolbar/action; thêm state drawer cần tránh làm ảnh hưởng các dropdown hiện có.
- Nếu class CSS giữa timeline todo và drawer bị dùng chéo không đúng ngữ cảnh, giao diện có thể lệch spacing hoặc màu sắc.
- Cần bảo đảm responsive giống pattern drawer hiện có để không làm vỡ layout trên mobile.
