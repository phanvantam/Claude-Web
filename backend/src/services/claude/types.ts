import { ChatMessage } from '../../types';

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
  /** Pending permission request đang chờ user xác nhận */
  pendingPermission?: {
    toolName: string;
    input: Record<string, unknown>;
    resolve: (result: any) => void;
  };
}

/** Config truyền vào runSDKQuery — tách riêng để dùng chung */
export interface SDKQueryConfig {
  cwd: string;
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  systemPrompt?: string;
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
