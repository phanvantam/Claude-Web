import type { Project, GlobalConfig } from '../types';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return {} as T;
  return res.json();
}

// Projects API
export const projectsApi = {
  getAll: () => fetchJSON<Project[]>('/projects'),
  getById: (id: string) => fetchJSON<Project>(`/projects/${id}`),
  create: (data: { name: string; path: string; description?: string }) =>
    fetchJSON<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<Project>) =>
    fetchJSON<Project>(`/projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    fetchJSON<void>(`/projects/${id}`, { method: 'DELETE' }),
};

// Config API
export const configApi = {
  get: () => fetchJSON<GlobalConfig>('/config'),
  update: (config: Partial<GlobalConfig>) =>
    fetchJSON<GlobalConfig>('/config', { method: 'PUT', body: JSON.stringify(config) }),
};

// Sessions API
import type { ChatSession, ChatMessage } from '../types';

/** Kết quả phân trang messages */
export interface PaginatedMessages {
  messages: ChatMessage[];
  nextCursor: number | null;
  hasMore: boolean;
  totalCount: number;
}

export const sessionsApi = {
  getAll: () => fetchJSON<ChatSession[]>('/sessions'),
  getById: (id: string) => fetchJSON<ChatSession>(`/sessions/${id}`),
  delete: (id: string) => fetchJSON<void>(`/sessions/${id}`, { method: 'DELETE' }),
  /** Lấy danh sách sessionId đang xử lý (processing) */
  getActive: () => fetchJSON<{ processing: string[] }>('/sessions/active'),
  /** Kiểm tra trạng thái xử lý của session — fallback khi WebSocket event bị mất */
  getSessionStatus: (sessionId: string) => fetchJSON<{ isProcessing: boolean }>(`/sessions/${sessionId}/status`),

  /**
   * Lấy messages phân trang (cursor-based).
   * Không truyền cursor = lấy messages mới nhất.
   */
  getMessages: (sessionId: string, cursor?: number, limit = 20) => {
    const params = new URLSearchParams();
    if (cursor !== undefined) params.set('cursor', String(cursor));
    params.set('limit', String(limit));
    return fetchJSON<PaginatedMessages>(`/sessions/${sessionId}/messages?${params.toString()}`);
  },
  
  update: (id: string, data: Partial<ChatSession>) =>
    fetchJSON<{ success: true }>(`/sessions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  /** Lấy danh sách sub-agents đã chạy trong session */
  listSubAgents: (sessionId: string) =>
    fetchJSON<import('../types').SubAgentInfo[]>(`/sessions/${sessionId}/subagents`),

  /** Lấy timeline events của một sub-agent cụ thể */
  getSubAgentTimeline: (sessionId: string, agentId: string) =>
    fetchJSON<import('../types').SubAgentTimelineEvent[]>(`/sessions/${sessionId}/subagents/${agentId}/timeline`),
};

// Claude CLI Metadata API
export interface SlashCommand {
  cmd: string;
  desc: string;
  source: string;
}

export interface ModelInfo {
  key: string;
  label: string;
  modelId?: string;
}

export const claudeApi = {
  /** Lấy danh sách slash commands (builtin + plugin + custom) */
  getCommands: (projectId?: string) => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return fetchJSON<SlashCommand[]>(`/claude/commands${query}`);
  },
  /** Lấy danh sách models khả dụng + model đang active */
  getModels: () => fetchJSON<{ models: ModelInfo[]; current: string }>('/claude/models'),
  /** Đọc nội dung raw của ~/.claude/settings.json */
  getRawSettings: () => fetchJSON<{ content: string }>('/claude/settings/raw'),
  /** Ghi nội dung JSON vào ~/.claude/settings.json */
  updateRawSettings: (content: string) =>
    fetchJSON<{ success: boolean }>('/claude/settings/raw', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  /** Đọc cấu hình mcpServers từ ~/.claude.json và <projectPath>/.mcp.json */
  getMcpServers: (projectId?: string) => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return fetchJSON<{ content: string }>(`/claude/mcp/servers${query}`);
  },
  /** Ghi cấu hình mcpServers vào ~/.claude.json */
  updateMcpServers: (content: string) =>
    fetchJSON<{ success: boolean }>('/claude/mcp/servers', {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  /** Lấy MCP servers tách biệt: global + project */
  getMcpServersDetailed: (projectId?: string) => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return fetchJSON<{
      global: Record<string, any>;
      project: Record<string, any>;
      projectPath: string | null;
    }>(`/claude/mcp/detailed${query}`);
  },
  /** Ghi MCP servers per-project */
  updateProjectMcpServers: (projectId: string, content: string) =>
    fetchJSON<{ success: boolean }>('/claude/mcp/project-servers', {
      method: 'POST',
      body: JSON.stringify({ projectId, content }),
    }),
  /** Lấy danh sách agent files */
  listAgents: () => fetchJSON<{ name: string; filename: string }[]>('/claude/agents'),
  /** Lấy danh sách agents kèm description — dùng cho @mention autocomplete.
   *  Truyền projectId để scan cả project/local scope. */
  listAgentsWithDesc: (projectId?: string) => {
    const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
    return fetchJSON<{
      name: string; filename: string; description: string;
      scope: 'user' | 'project' | 'local';
      model?: string; tools?: string[]; permissionMode?: string;
    }[]>(`/claude/agents/with-desc${query}`);
  },
  /** Đọc nội dung agent */
  getAgent: (filename: string) => fetchJSON<{ content: string }>(`/claude/agents/${filename}`),
  /** Cập nhật nội dung agent */
  updateAgent: (filename: string, content: string) =>
    fetchJSON<{ success: boolean }>(`/claude/agents/${filename}`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),
  /** Tạo agent mới */
  createAgent: (name: string) =>
    fetchJSON<{ filename: string }>('/claude/agents', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  /** Xóa agent */
  deleteAgent: (filename: string) =>
    fetchJSON<{ success: boolean }>(`/claude/agents/${filename}`, { method: 'DELETE' }),

  // ── Custom Slash Commands ──

  /** Liệt kê custom commands theo scope */
  listCustomCommands: (scope: 'global' | 'project', projectId?: string) => {
    const params = new URLSearchParams({ scope });
    if (projectId) params.set('projectId', projectId);
    return fetchJSON<{ filename: string; name: string; desc: string }[]>(
      `/claude/commands/custom?${params.toString()}`,
    );
  },
  /** Đọc nội dung custom command */
  getCustomCommand: (filename: string, scope: 'global' | 'project', projectId?: string) => {
    const params = new URLSearchParams({ scope });
    if (projectId) params.set('projectId', projectId);
    return fetchJSON<{ content: string }>(
      `/claude/commands/custom/${encodeURIComponent(filename)}?${params.toString()}`,
    );
  },
  /** Tạo hoặc cập nhật custom command */
  saveCustomCommand: (filename: string, content: string, scope: 'global' | 'project', projectId?: string) =>
    fetchJSON<{ success: boolean }>(`/claude/commands/custom/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      body: JSON.stringify({ content, scope, projectId }),
    }),
  /** Xóa custom command */
  deleteCustomCommand: (filename: string, scope: 'global' | 'project', projectId?: string) => {
    const params = new URLSearchParams({ scope });
    if (projectId) params.set('projectId', projectId);
    return fetchJSON<{ success: boolean }>(
      `/claude/commands/custom/${encodeURIComponent(filename)}?${params.toString()}`,
      { method: 'DELETE' },
    );
  },
};
