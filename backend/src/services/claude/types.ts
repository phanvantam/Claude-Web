import { ChatMessage, ContentBlock, ToolCall } from '../../types';

export interface ClaudeSessionState {
  sessionId: string;
  projectId: string;
  isProcessing: boolean;
  /** Timestamp (ms) khi bắt đầu processing — dùng cho elapsed timer */
  processingStartedAt?: number;
  messages: ChatMessage[];
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  /** Tên phiên (tin nhắn user đầu tiên) — lưu 1 lần duy nhất */
  sessionName?: string;
  /** AbortController cho query hiện tại — dùng để cancel */
  abortController?: AbortController;
  /** SDK query instance — cần gọi interrupt() để thực sự dừng tiến trình CLI */
  queryInstance?: { interrupt: () => Promise<void>; [key: string]: any };
  /** Pending permission request đang chờ user xác nhận */
  pendingPermission?: {
    toolName: string;
    input: Record<string, unknown>;
    resolve: (result: any) => void;
  };
  /** Tool đang chạy gần nhất khi status = tool_use */
  activeToolName?: string;
  /** Sub-agent đang hoạt động (nếu có) để restore UI sau reload */
  activeSubAgent?: {
    name: string;
    prompt: string;
    lastHeartbeat?: number;
    activities?: Array<{ toolName: string; inputSummary?: string; timestamp: number }>;
    currentToolName?: string;
  };
  /** Partial blocks của assistant turn đang chạy — để restore UI sau reload */
  partialAssistantBlocks?: ContentBlock[];
  /** Partial toolCalls của assistant turn đang chạy */
  partialToolCalls?: ToolCall[];
  /** Partial text content string đang tích lũy */
  partialAssistantContent?: string;
  /** Linux completion token đã được phát hiện trong stream text */
  linuxCompletionTokenDetected?: boolean;
  /** Timestamp khi user yêu cầu dừng — dùng để chặn stream events còn tồn */
  abortRequestedAt?: number;
  /** Lý do interrupt gần nhất để hiển thị trạng thái dừng rõ ràng */
  interruptReason?: 'user_abort' | 'watchdog_timeout' | 'linux_completion_token' | 'unknown';
}

/** Config truyền vào runSDKQuery — tách riêng để dùng chung */
export interface SDKQueryConfig {
  cwd: string;
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  systemPrompt?: string;
  /** Giới hạn số turn — SDK tự dừng và trả error_max_turns */
  maxTurns?: number;
  /** Giới hạn chi phí USD — SDK tự dừng và trả error_max_budget_usd */
  maxBudgetUsd?: number;
  customArgs?: string[];
}

export interface SubAgentInfo {
  agentId: string;
  agentType: string;
  description: string;
  messageCount: number;
  startedAt: string;
}

export interface SubAgentEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text';
  content: string;
  timestamp: string;
  toolName?: string;
  isError?: boolean;
}
