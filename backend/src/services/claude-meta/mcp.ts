/**
 * Quản lý MCP (Model Context Protocol) servers.
 *
 * Tách từ claude-meta.ts — nhóm các hàm liên quan đến đọc/ghi cấu hình
 * mcpServers trong ~/.claude.json và project-level .mcp.json.
 */

import fs from 'fs';
import path from 'path';
import { CLAUDE_JSON_FILE, readClaudeJson } from './shared';

/**
 * Lấy cấu hình mcpServers (JSON string đã format).
 * Hỗ trợ trộn cả ~/.claude.json và <projectPath>/.mcp.json (nếu có).
 */
export function getMcpServers(projectPath?: string): string {
  const globalData = readClaudeJson();
  let servers = globalData.mcpServers || {};

  if (projectPath) {
    try {
      const localFsPath = path.join(projectPath, '.mcp.json');
      if (fs.existsSync(localFsPath)) {
        const localData = JSON.parse(fs.readFileSync(localFsPath, 'utf-8'));
        if (localData.mcpServers) {
          servers = { ...servers, ...localData.mcpServers };
        }
      }
    } catch {
      // Bỏ qua nếu lỗi đọc file local
    }
  }

  return JSON.stringify(servers, null, 2);
}

/**
 * Cập nhật mcpServers trong ~/.claude.json.
 * Chỉ ghi đè trường mcpServers, giữ nguyên toàn bộ dữ liệu khác.
 */
export function updateMcpServers(rawJson: string): void {
  // Validate cú pháp JSON
  const parsed = JSON.parse(rawJson);

  const data = readClaudeJson();
  data.mcpServers = parsed;

  fs.writeFileSync(CLAUDE_JSON_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Lấy MCP servers tách biệt: global + project-specific.
 * Global: ~/.claude.json → mcpServers (root level)
 * Project: ~/.claude.json → projects[projectPath].mcpServers
 * Hữu ích cho UI hiển thị 2 phần riêng biệt.
 */
export function getMcpServersDetailed(projectPath?: string): {
  global: Record<string, any>;
  project: Record<string, any>;
  projectPath: string | null;
} {
  const data = readClaudeJson();
  const global = data.mcpServers || {};
  let project: Record<string, any> = {};

  if (projectPath && data.projects && data.projects[projectPath]) {
    project = data.projects[projectPath].mcpServers || {};
  }

  return { global, project, projectPath: projectPath || null };
}

/**
 * Cập nhật mcpServers của một project cụ thể trong ~/.claude.json.
 * Ghi vào: projects[projectPath].mcpServers
 * Tạo key project nếu chưa tồn tại.
 */
export function updateProjectMcpServers(projectPath: string, rawJson: string): void {
  const parsed = JSON.parse(rawJson);
  const data = readClaudeJson();

  // Đảm bảo key projects tồn tại
  if (!data.projects) data.projects = {};
  if (!data.projects[projectPath]) data.projects[projectPath] = {};

  data.projects[projectPath].mcpServers = parsed;

  fs.writeFileSync(CLAUDE_JSON_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
