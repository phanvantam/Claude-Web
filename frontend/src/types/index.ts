// Re-export the shared types from backend
// These mirror the backend types for frontend usage

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  activeSessionId?: string | null;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  /** Live preview input đang stream — chỉ tồn tại khi tool đang nhận delta */
  streamingInput?: string;
}

/** Một tool call nội bộ của sub-agent — dùng để hiển thị trong collapsible section */
export interface SubAgentActivity {
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool: ToolCall }
  | { type: 'thinking'; thinking: string }
  | { 
      type: 'subagent_result'; 
      agentName: string; 
      result: string; 
      isError?: boolean; 
      activities?: SubAgentActivity[];
      usage?: { tokens: number; tools: number; durationMs: number };
      agentId?: string;
    };

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  blocks?: ContentBlock[];
  toolCalls?: ToolCall[];
  timestamp: string;
  isStreaming?: boolean;
  cost?: number;
  model?: string;
  durationMs?: number;
  tokens?: {
    input: number;
    output: number;
  };
}

export interface ChatSession {
  id: string;
  projectId: string;
  sessionId: string;
  name?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  totalCost?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  /** Số tin nhắn trong phiên — chỉ có khi lấy từ danh sách sessions */
  messageCount?: number;
}

export interface GlobalConfig {
  model?: string;
  maxBudgetUsd?: number;
  permissionMode?: string;
  systemPrompt?: string;
  customArgs?: string[];
  theme?: 'light' | 'dark';
}

// ============================
// Sub-Agent Types
// ============================

/** Thông tin tổng quan của một sub-agent đã chạy trong session */
export interface SubAgentInfo {
  agentId: string;
  /** Loại agent: "Plan", "Bash", custom name... */
  agentType: string;
  description: string;
  /** Số events trong transcript */
  messageCount: number;
  /** Thời điểm bắt đầu chạy (ISO string) */
  startedAt?: string;
}

/** Một event trong timeline của sub-agent */
export interface SubAgentTimelineEvent {
  type: 'thinking' | 'tool_use' | 'tool_result' | 'text';
  content: string;
  timestamp: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  isError?: boolean;
}

// Todo list types
export interface TodoItem {
  content?: string;
  activeForm?: string;
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface TodoList {
  id: string;           // Unique ID: `todo-${timestamp}-${random}`
  label: string;        // Auto-generated from first todo item
  todos: TodoItem[];
  timestamp: string;    // ISO timestamp when list was created
  messageId?: string;   // Source message ID for history tracking
  toolCallId?: string;  // Source tool call ID
}
