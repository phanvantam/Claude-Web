import { v4 as uuidv4 } from 'uuid';
import db from './db';
import type { Project } from '../types';

/**
 * Lấy toàn bộ danh sách projects, sắp xếp theo thời gian tạo giảm dần.
 */
export function getAllProjects(): Project[] {
  const rows = db.prepare(
    'SELECT id, name, path, description, active_session_id, created_at, updated_at FROM projects ORDER BY created_at DESC'
  ).all() as any[];

  return rows.map(rowToProject);
}

/**
 * Lấy project theo ID.
 */
export function getProject(id: string): Project | undefined {
  const row = db.prepare(
    'SELECT id, name, path, description, active_session_id, created_at, updated_at FROM projects WHERE id = ?'
  ).get(id) as any;

  return row ? rowToProject(row) : undefined;
}

/**
 * Tạo project mới.
 */
export function createProject(data: { name: string; path: string; description?: string }): Project {
  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(
    'INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, data.name, data.path, data.description ?? null, now, now);

  return { id, name: data.name, path: data.path, description: data.description, createdAt: now, updatedAt: now };
}

/**
 * Cập nhật project. Chỉ cập nhật các trường được truyền vào.
 */
export function updateProject(
  id: string,
  data: Partial<Pick<Project, 'name' | 'path' | 'description' | 'activeSessionId'>>
): Project | null {
  const existing = getProject(id);
  if (!existing) return null;

  const now = new Date().toISOString();

  db.prepare(`
    UPDATE projects
    SET name = ?, path = ?, description = ?, active_session_id = ?, updated_at = ?
    WHERE id = ?
  `).run(
    data.name ?? existing.name,
    data.path ?? existing.path,
    data.description !== undefined ? data.description : existing.description ?? null,
    data.activeSessionId !== undefined ? data.activeSessionId : existing.activeSessionId ?? null,
    now,
    id,
  );

  return getProject(id)!;
}

/**
 * Xoá project theo ID. Cascade sẽ tự xoá sessions + messages liên quan.
 */
export function deleteProject(id: string): boolean {
  const result = db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Chuyển đổi row SQLite (snake_case) sang interface Project (camelCase).
 */
function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    description: row.description ?? undefined,
    activeSessionId: row.active_session_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
