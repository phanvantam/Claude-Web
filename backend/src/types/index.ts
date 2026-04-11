// ============================
// Project Types
// ============================
export interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  activeSessionId?: string | null;
}

// ============================
// Claude CLI Stream JSON Types
// ============================
export interface ClaudeStreamMessage {
  type: string;
  subtype?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking';
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  is_error?: boolean;
}

export interface ClaudeAssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: ClaudeContentBlock[];
    model: string;
    stop_reason: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  session_id: string;
}

export interface ClaudeResultMessage {
  type: 'result';
  subtype: 'success' | 'error';
  cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  is_error: boolean;
  num_turns: number;
  session_id: string;
  total_cost_usd: number;
}

// ============================
// Chat Types (for Frontend)
// ============================
export type MessageRole = 'user' | 'assistant' | 'system';

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

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  /** Nội bộ: tích lũy partial JSON từ input_json_delta — sẽ bị xóa trước khi emit */
  _inputJsonStr?: string;
}

// ============================
// Session Types
// ============================
export interface ChatSession {
  id: string;
  projectId: string;
  sessionId: string;  // Claude CLI session ID
  name?: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
  totalCost?: number;
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
}

// ============================
// Config Types
// ============================
export interface GlobalConfig {
  model?: string;
  maxBudgetUsd?: number;
  permissionMode?: string;
  systemPrompt?: string;
  customArgs?: string[];
  theme?: 'light' | 'dark';
}

// ============================
// Socket Events
// ============================
export interface ServerToClientEvents {
  'chat:message': (data: { sessionId: string; message: ChatMessage }) => void;
  'chat:stream': (data: { sessionId: string; content: string; messageId: string }) => void;
  'chat:stream:end': (data: { sessionId: string; messageId: string; finalMessage: ChatMessage }) => void;
  'chat:error': (data: { sessionId: string; error: string }) => void;
  'chat:status': (data: { sessionId: string; status: 'idle' | 'initializing' | 'thinking' | 'tool_use'; toolName?: string }) => void;
  'session:started': (data: { sessionId: string }) => void;
  'session:ended': (data: { sessionId: string }) => void;
}

export interface ClientToServerEvents {
  'chat:send': (data: { sessionId: string; message: string }) => void;
  'chat:abort': (data: { sessionId: string }) => void;
  'session:start': (data: { projectId: string; sessionId?: string }) => void;
  'session:stop': (data: { sessionId: string }) => void;
}
