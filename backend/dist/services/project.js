"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllProjects = getAllProjects;
exports.getProject = getProject;
exports.createProject = createProject;
exports.updateProject = updateProject;
exports.deleteProject = deleteProject;
const uuid_1 = require("uuid");
const db_1 = __importDefault(require("./db"));
/**
 * Lấy toàn bộ danh sách projects, sắp xếp theo thời gian tạo giảm dần.
 */
function getAllProjects() {
    const rows = db_1.default.prepare('SELECT id, name, path, description, active_session_id, created_at, updated_at FROM projects ORDER BY created_at DESC').all();
    return rows.map(rowToProject);
}
/**
 * Lấy project theo ID.
 */
function getProject(id) {
    const row = db_1.default.prepare('SELECT id, name, path, description, active_session_id, created_at, updated_at FROM projects WHERE id = ?').get(id);
    return row ? rowToProject(row) : undefined;
}
/**
 * Tạo project mới.
 */
function createProject(data) {
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    db_1.default.prepare('INSERT INTO projects (id, name, path, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, data.name, data.path, data.description ?? null, now, now);
    return { id, name: data.name, path: data.path, description: data.description, createdAt: now, updatedAt: now };
}
/**
 * Cập nhật project. Chỉ cập nhật các trường được truyền vào.
 */
function updateProject(id, data) {
    const existing = getProject(id);
    if (!existing)
        return null;
    const now = new Date().toISOString();
    db_1.default.prepare(`
    UPDATE projects
    SET name = ?, path = ?, description = ?, active_session_id = ?, updated_at = ?
    WHERE id = ?
  `).run(data.name ?? existing.name, data.path ?? existing.path, data.description !== undefined ? data.description : existing.description ?? null, data.activeSessionId !== undefined ? data.activeSessionId : existing.activeSessionId ?? null, now, id);
    return getProject(id);
}
/**
 * Xoá project theo ID. Cascade sẽ tự xoá sessions + messages liên quan.
 */
function deleteProject(id) {
    const result = db_1.default.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return result.changes > 0;
}
/**
 * Chuyển đổi row SQLite (snake_case) sang interface Project (camelCase).
 */
function rowToProject(row) {
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
//# sourceMappingURL=project.js.map