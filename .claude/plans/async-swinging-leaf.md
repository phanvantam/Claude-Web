# Plan: Thêm nút TodoList vào toolbar chat box

## Context

Người dùng muốn thêm một nút trên toolbar của chat input box để mở ra TodoList drawer, giúp theo dõi tình trạng các task mà Claude AI đang xử lý qua tool `TodoWrite`.

**Hiện trạng:**
- Tool `TodoWrite` đã được render bên trong `ToolCallCard.tsx` dưới dạng `TodoChecklist` - chỉ hiển thị trong timeline của assistant message
- Không có view tổng hợp để theo dõi tất cả todos trong session
- Toolbar của InputBox có 4 dropdown buttons: Model, Effort, Permission, Agent
- Pattern drawer đã có sẵn (SubAgentDrawer, SkillDrawer, PlanDrawer)

**Mục tiêu:** Thêm nút TodoList vào toolbar → mở drawer hiển thị tất cả todos từ session

## Các bước thực hiện

### Bước 1: Tạo TodoDrawer component
- **File:** `frontend/src/components/Chat/TodoDrawer.tsx`
- **Pattern:** Copy từ `SubAgentDrawer.tsx` hoặc `PlanDrawer.tsx`
- **Chiều rộng:** 380px (tương tự SubAgentDrawer)
- **Props:**
  ```typescript
  interface TodoDrawerProps {
    open: boolean;
    onClose: () => void;
    todos: TodoItem[];  // todos extracted from messages
  }
  ```
- **Nội dung drawer:**
  - Header với icon `CheckSquareOutlined` + title "Danh sách Todo"
  - Danh sách todos được group theo status: `in_progress` → `pending` → `completed`
  - Mỗi item hiển thị: icon status + content/activeForm
  - Badge count tổng số todos chưa hoàn thành
  - Empty state khi không có todos

### Bước 2: Thêm nút TodoList vào toolbar InputBox
- **File:** `frontend/src/components/Chat/InputBox.tsx`
- **Thêm state:**
  ```typescript
  const [todoDrawerOpen, setTodoDrawerOpen] = useState(false);
  ```
- **Thêm button vào `.input-toolbar`** (sau Agent button):
  ```tsx
  <button
    className={`toolbar-btn${hasIncompleteTodos ? ' toolbar-btn-active' : ''}`}
    onClick={() => setTodoDrawerOpen(true)}
    title="Danh sách Todo"
  >
    <CheckSquareOutlined />
    <span>Todo</span>
  </button>
  ```
- **Props mới của InputBox:**
  ```typescript
  hasIncompleteTodos?: boolean;  // để active style nếu có todos
  ```
- **Render `<TodoDrawer>`** bên dưới InputBox

### Bước 3: Truyền todos xuống InputBox từ ChatPage
- **File:** `frontend/src/pages/ChatPage.tsx`
- Extract todos từ messages:
  ```typescript
  const todos = useMemo(() => {
    const result: TodoItem[] = [];
    messages.forEach(msg => {
      msg.blocks?.forEach(block => {
        if (block.type === 'tool_use' && block.tool.name === 'TodoWrite') {
          const blockTodos = (block.tool.input.todos || []) as TodoItem[];
          result.push(...blockTodos);
        }
      });
    });
    return result;
  }, [messages]);
  ```
- Truyền xuống InputBox:
  ```tsx
  <InputBox
    ...
    hasIncompleteTodos={todos.some(t => t.status !== 'completed')}
  />
  <TodoDrawer
    open={todoDrawerOpen}
    onClose={() => setTodoDrawerOpen(false)}
    todos={todos}
  />
  ```

### Bước 4: Style cho TodoDrawer
- **File:** `frontend/src/styles/drawers.css`
- Thêm CSS cho `.todo-drawer` header + body styling (tương tự `.mcp-drawer`)

## Các file cần tạo/sửa

| File | Action | Mô tả |
|------|--------|--------|
| `frontend/src/components/Chat/TodoDrawer.tsx` | **Tạo mới** | Drawer component |
| `frontend/src/components/Chat/InputBox.tsx` | Sửa | Thêm button + state + render TodoDrawer |
| `frontend/src/components/Chat/InputBox/types.ts` | Sửa | Thêm `hasIncompleteTodos` vào props |
| `frontend/src/pages/ChatPage.tsx` | Sửa | Extract todos + truyền xuống InputBox |
| `frontend/src/styles/drawers.css` | Sửa | Thêm style cho TodoDrawer |

## Reuse patterns

- **Drawer component pattern:** từ `SubAgentDrawer.tsx` (340px, antd Drawer, mobile responsive)
- **Icon:** `CheckSquareOutlined` từ `@ant-design/icons`
- **CSS classes:** `.todo-checklist`, `.todo-item`, `.todo-status-icon` đã có trong `chat-timeline.css`
- **Mobile handling:** dùng `isMobile` state như các drawer khác

## Verification

1. Mở chat page → thấy nút "Todo" trên toolbar
2. Click nút → mở TodoDrawer bên phải
3. Nếu có todos trong session → hiển thị danh sách
4. Nếu không có todos → hiển thị empty state
5. Active style trên button khi có todos chưa hoàn thành
6. Responsive trên mobile ≤768px
7. Build thành công: `npm run build` ở frontend
