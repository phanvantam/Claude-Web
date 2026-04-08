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
import type { ChatSession } from '../types';
export const sessionsApi = {
  getAll: () => fetchJSON<ChatSession[]>('/sessions'),
  getById: (id: string) => fetchJSON<ChatSession>(`/sessions/${id}`),
  delete: (id: string) => fetchJSON<void>(`/sessions/${id}`, { method: 'DELETE' }),
};
