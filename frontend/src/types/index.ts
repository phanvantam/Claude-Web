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
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; tool: ToolCall };

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
}

export interface GlobalConfig {
  model?: string;
  maxBudgetUsd?: number;
  permissionMode?: string;
  systemPrompt?: string;
  customArgs?: string[];
  theme?: 'light' | 'dark';
}
