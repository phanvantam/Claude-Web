# Kế hoạch Tối ưu hoá & Nâng cấp Hệ thống theo chuẩn Claude Agent SDK

> **Triết lý**: "UI là lớp vỏ, SDK là bộ não" — Zero Redundancy
>
> **Trạng thái**: ✅ Đã triển khai hoàn tất 6/6 Phase — TypeScript build thành công

---

## Phase 1: Watchdog Refactor — Từ Timer Cứng sang Event-Driven ✅

### Phân tích Hiện trạng

Hiện tại `sdkRunner.ts` sử dụng watchdog 2 tầng:
- **NGẮN (3s)**: Sau assistant event chỉ có text → giả định là response cuối → force interrupt.
- **DÀI (15s)**: Sau tool_use, system, user → chờ tool chạy xong.
- **SKIP**: Nếu đang chờ pendingPermission → không giới hạn.

### Dữ liệu Thực tế từ Cộng đồng & SDK

| Nguồn | Phát hiện |
| :--- | :--- |
| [GitHub Issue #533](https://github.com/anthropics/claude-agent-sdk-python/issues/533) | SDK có timeout nội bộ **~10 phút** cho streaming requests. Khi stream bị treo, SDK tự retry. Watchdog 15s của ta đang **giết nhầm** các tiến trình retry hợp lệ. |
| [GitHub Issue #541](https://github.com/anthropics/claude-agent-sdk-python/issues/541) | `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT` mặc định 60s. Nếu MCP tools chạy lâu, cần set lên 180000ms (3 phút). Dự án ta đang set 300000ms (5 phút). |
| SDK `sdk.d.ts` (dòng 407) | SDK ghi rõ: *"If your SDK MCP calls will run longer than 60s, override `CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`"*. |
| SDK `sdk.d.ts` - `maxTurns` | SDK có cơ chế `maxTurns` và `maxBudgetUsd` native → tự động dừng khi vượt giới hạn, trả về `error_max_turns` hoặc `error_max_budget_usd`. |
| SDK `sdk.d.ts` - `agentProgressSummaries` | SDK hỗ trợ phát `task_progress` mỗi ~30s cho sub-agent đang chạy → bằng chứng sub-agent còn sống mà không cần watchdog. |

### Vấn đề Cụ thể với Watchdog 3s

- **Thinking phase kéo dài**: Khi `effort: "high"` hoặc `"max"`, Claude có thể suy nghĩ 10-30s trước khi phát assistant event tiếp theo. Watchdog 3s sẽ force interrupt giữa chừng → **Data Loss** nghiêm trọng.
- **Sub-agent khởi động**: Khi Claude đang spawn sub-agent, khoảng cách giữa assistant event cuối (chứa `tool_use: Agent`) và user event đầu tiên (chứa `tool_result`) có thể lên tới **5-20s** do sub-agent cần init. Watchdog 15s vẫn có thể cắt nhầm.

### Đề xuất: Chiến lược Watchdog Mới

#### [MODIFY] [backend/src/services/claude/sdkRunner.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/sdkRunner.ts)

**Bỏ hoàn toàn watchdog timer cứng.** Thay bằng chiến lược event-driven:

```typescript
// TRƯỚC (timer cứng — nguy hiểm)
const WATCHDOG_SHORT_MS = 3_000;
const WATCHDOG_LONG_MS = 15_000;

// SAU (event-driven — tin tưởng SDK)
// 1. Dùng maxTurns + maxBudgetUsd để SDK tự dừng khi vượt giới hạn
// 2. Chỉ giữ 1 safety net duy nhất: GLOBAL_TIMEOUT = 10 phút
//    (khớp với timeout nội bộ của SDK cho streaming)
// 3. Bật agentProgressSummaries để nhận heartbeat từ sub-agent

const GLOBAL_SAFETY_TIMEOUT_MS = 600_000; // 10 phút — chỉ bắt trường hợp CLI crash thực sự
```

**Chi tiết triển khai:**

| Cơ chế | Giá trị | Mục đích |
| :--- | :--- | :--- |
| `options.maxTurns` | `50` (default, user có thể điều chỉnh) | Ngăn vòng lặp vô tận — SDK tự dừng và trả `error_max_turns` |
| `options.maxBudgetUsd` | `5.0` (default, user có thể điều chỉnh) | Kiểm soát chi phí — SDK trả `error_max_budget_usd` |
| `GLOBAL_SAFETY_TIMEOUT` | `600_000ms` (10 phút) | Safety net cuối cùng, chỉ khi CLI thực sự treo (crash/zombie) |
| `agentProgressSummaries` | `true` | Nhận tín hiệu heartbeat mỗi ~30s từ sub-agent → reset global timer |
| Watchdog 3s/15s | **Xóa bỏ** | Không cần thiết — SDK đã tự quản lý vòng đời |

---

## Phase 2: Agent Injection — Nạp Definitions vào SDK ✅

### Hiện trạng

- `claude-meta.ts` đọc file `.md` từ 3 scope (user/project/local), parse frontmatter.
- `sdkRunner.ts` **không** truyền danh sách agent vào SDK → Claude phải tự phát hiện.
- Sub-agent tracking sử dụng logic thủ công: parse `tool_use` có tên `Agent`/`Task`.

### Đề xuất

#### [MODIFY] [backend/src/services/claude-meta.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude-meta.ts)

Thêm hàm chuyển đổi `AgentDefinition[]` → format SDK:

```typescript
/** Chuyển đổi danh sách agent file sang format SDK options.agents */
export function buildSDKAgentDefinitions(projectPath?: string): Record<string, SDKAgentDef> {
  const agents = listAllAgents(projectPath);
  const result: Record<string, SDKAgentDef> = {};
  for (const agent of agents) {
    const content = getAgent(agent.filename, projectPath);
    // Bỏ phần frontmatter, chỉ lấy body làm prompt
    const promptBody = content.replace(/^---[\s\S]*?---\s*/, '').trim();
    result[agent.name] = {
      description: agent.frontmatter.description || `Agent ${agent.name}`,
      prompt: promptBody,
      tools: agent.frontmatter.tools,
      model: agent.frontmatter.model === 'inherit' ? undefined : agent.frontmatter.model,
      maxTurns: agent.frontmatter.maxTurns,
      permissionMode: agent.frontmatter.permissionMode as any,
    };
  }
  return result;
}
```

#### [MODIFY] [backend/src/services/claude/sdkRunner.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/sdkRunner.ts)

Truyền agents vào SDK options:

```typescript
// Trước sdk.query():
import { buildSDKAgentDefinitions } from '../claude-meta';
const agentDefs = buildSDKAgentDefinitions(config.cwd);
if (Object.keys(agentDefs).length > 0) {
  options.agents = agentDefs;
  // Đảm bảo Agent tool được bật
  if (!options.allowedTools) options.allowedTools = [];
  if (!options.allowedTools.includes('Agent')) options.allowedTools.push('Agent');
}
```

---

## Phase 3: Native Event Handling — Lắng nghe Đúng Tín Hiệu ✅

### Hiện trạng

`sdkRunner.ts` chỉ xử lý 4 event types: `system`, `assistant`, `user`, `result`.
SDK thực tế phát ra **25+ event types** (xem `SDKMessage` union type).

### Các Event Cần Bổ Sung

#### [MODIFY] [backend/src/services/claude/sdkRunner.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/sdkRunner.ts)

Thêm xử lý trong switch-case:

```typescript
case 'system': {
  const subtype = (sdkMsg as any).subtype;
  switch (subtype) {
    case 'init':
      // Init event — đã xử lý
      break;
    case 'compact_boundary':
      // Nén context tự động — thông báo UI
      emitter.emit('compact:boundary', {
        sessionId,
        trigger: (sdkMsg as any).compact_metadata?.trigger,
        preTokens: (sdkMsg as any).compact_metadata?.pre_tokens,
        postTokens: (sdkMsg as any).compact_metadata?.post_tokens,
      });
      break;
    case 'task_started':
      // Sub-agent bắt đầu — THAY THẾ logic parse tool_use thủ công
      emitter.emit('task:start', {
        sessionId,
        taskId: (sdkMsg as any).task_id,
        description: (sdkMsg as any).description,
        taskType: (sdkMsg as any).task_type,
      });
      break;
    case 'task_updated':
      emitter.emit('task:update', {
        sessionId,
        taskId: (sdkMsg as any).task_id,
      });
      break;
  }
  break;
}
```

Thêm xử lý ngoài switch-case cho event types mới:

```typescript
// Task progress — heartbeat mỗi ~30s từ sub-agent
if (type === 'task_progress') {
  emitter.emit('task:progress', {
    sessionId,
    taskId: (sdkMsg as any).task_id,
    summary: (sdkMsg as any).summary,
  });
}

// Prompt suggestion — gợi ý câu hỏi tiếp theo
if (type === 'prompt_suggestion') {
  emitter.emit('prompt:suggestion', {
    sessionId,
    suggestion: (sdkMsg as any).suggestion,
  });
}

// Rate limit — thông báo giới hạn
if (type === 'rate_limit_event') {
  emitter.emit('rate:limit', {
    sessionId,
    info: (sdkMsg as any).rate_limit_info,
  });
}
```

#### [DELETE logic] Sub-agent Tracking Thủ công

Xóa toàn bộ logic sau trong `handleAssistantEvent`:
- Biến `ctx.activeTaskToolId`, `ctx.activeTaskAgentName`, `ctx.subAgentActivities`
- Đoạn `if (toolNameLower === 'agent' || toolNameLower === 'task')` 
- Emit `subagent:started` thủ công

→ Thay bằng native event `task_started` ở Phase trên.

---

## Phase 4: Xóa bỏ compact.ts — SDK Tự Nén ✅

### Phân tích

File [compact.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/compact.ts) đang **làm lại** hoàn toàn cơ chế nén context:
1. Tự build conversation text từ messages.
2. Gọi SDK query riêng với prompt tóm tắt bằng tiếng Việt.
3. Tạo session mới + chèn system message.

**Vấn đề**: SDK đã có cơ chế auto-compact tích hợp sẵn:
- Tự nén khi context vượt ngưỡng token.
- Phát ra event `compact_boundary` với metadata đầy đủ (`pre_tokens`, `post_tokens`).
- Giữ nguyên session, không cần tạo session mới.

### Đề xuất

#### [DEPRECATE] [backend/src/services/claude/compact.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/compact.ts)

- Đánh dấu deprecated, không xóa ngay (tương thích ngược).
- Frontend sẽ hiển thị `Compact Marker` từ event `compact_boundary` thay vì tạo session mới.
- Nếu user vẫn muốn compact thủ công: gửi prompt có chứa `/compact` → SDK tự xử lý.

---

## Phase 5: Permission Mode Selector — UI ở Toolbox ✅

### Quyết định

Permission Mode selector sẽ được đặt **ở toolbox phía trên input chat** (cùng hàng với chọn model, effort).

### Các Mode Hỗ trợ

| Mode | Icon | Mô tả |
| :--- | :--- | :--- |
| `default` | 🔒 | Hỏi user trước mỗi thao tác nguy hiểm |
| `acceptEdits` | ✏️ | Tự động cho phép sửa file, hỏi khi chạy bash |
| `auto` | 🤖 | AI tự phân loại mức nguy hiểm và quyết định |
| `plan` | 📋 | Chỉ lập kế hoạch, không thực thi tool |

#### [MODIFY] Frontend — Toolbox Component (InputBox area)

```tsx
// Thêm dropdown ở cạnh Model Selector trong ToolboxBar
<Select value={permissionMode} onChange={setPermissionMode}>
  <Option value="default">🔒 Hỏi quyền (Mặc định)</Option>
  <Option value="acceptEdits">✏️ Tự động sửa file</Option>
  <Option value="auto">🤖 AI tự quyết định</Option>
  <Option value="plan">📋 Chỉ lập kế hoạch</Option>
</Select>
```

#### [MODIFY] Backend — Nhận permissionMode từ Frontend

`sdkRunner.ts` đã hỗ trợ `config.permissionMode` → chỉ cần Frontend gửi giá trị qua WebSocket khi bắt đầu query.

---

## Phase 6: Tận Dụng Tính Năng SDK Mới ✅

### 6.1 `agentProgressSummaries`

#### [MODIFY] [backend/src/services/claude/sdkRunner.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/sdkRunner.ts)

```typescript
options.agentProgressSummaries = true;
// → SDK sẽ phát task_progress mỗi ~30s với field `summary`
// → Frontend hiển thị "Đang phân tích module authentication..."
```

### 6.2 `promptSuggestions`

```typescript
options.promptSuggestions = true;
// → SDK phát prompt_suggestion sau mỗi lượt
// → Frontend hiển thị chip gợi ý bên dưới input
```

### 6.3 `maxTurns` + `maxBudgetUsd`

Cho phép user điều chỉnh qua Settings hoặc per-session:

```typescript
if (config.maxTurns) options.maxTurns = config.maxTurns; // default: 50
if (config.maxBudgetUsd) options.maxBudgetUsd = config.maxBudgetUsd; // default: 5.0
```

---

## Bảng Tổng hợp Thay đổi

| File | Hành động | Mô tả |
| :--- | :--- | :--- |
| [sdkRunner.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/sdkRunner.ts) | MODIFY (lớn) | Xóa watchdog 3s/15s, thay bằng global 10m. Xóa sub-agent tracking thủ công. Thêm native event handlers. Bật `agentProgressSummaries` + `promptSuggestions`. |
| [claude-meta.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude-meta.ts) | MODIFY (nhỏ) | Thêm `buildSDKAgentDefinitions()`. |
| [claudeService.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/claudeService.ts) | MODIFY (nhỏ) | Gọi `buildSDKAgentDefinitions()` và truyền vào config. |
| [compact.ts](file:///Users/tampv/Projects/Claude-Web/backend/src/services/claude/compact.ts) | DEPRECATE | Đánh dấu deprecated. SDK tự nén. |
| Frontend Toolbox | MODIFY | Thêm Permission Mode dropdown. |
| Frontend Timeline | MODIFY | Thêm Compact Marker, Task Progress. |

## Thứ tự Triển khai (Ưu tiên)

1. **Phase 1** — Watchdog refactor (rủi ro cao nhất, ảnh hưởng production)
2. **Phase 3** — Native event handling (nền tảng cho các phase sau)
3. **Phase 5** — Permission Mode UI (quick win, user-facing)
4. **Phase 2** — Agent injection (cải thiện chất lượng sub-agent)
5. **Phase 6** — Tính năng SDK mới (polish)
6. **Phase 4** — Deprecate compact.ts (cleanup)

## Verification Plan

### Phase 1 Verification
- Gửi prompt phức tạp yêu cầu `effort: "high"` → xác nhận Claude có đủ thời gian suy nghĩ mà không bị interrupt.
- Gửi prompt yêu cầu spawn sub-agent → xác nhận sub-agent chạy hết mà không bị timeout 15s.
- Để session chạy vượt `maxTurns` → xác nhận SDK trả `error_max_turns` thay vì watchdog giết.

### Phase 3 Verification
- Chạy session dài vượt context limit → xác nhận UI nhận được event `compact:boundary`.
- Yêu cầu spawn sub-agent → xác nhận event `task:start` và `task:progress` xuất hiện trong log.

### Phase 5 Verification
- Đổi mode sang `auto` → xác nhận các lệnh Read/Grep tự auto-approve, chỉ hỏi khi Bash.
- Đổi mode sang `plan` → xác nhận không có tool nào thực sự chạy.
