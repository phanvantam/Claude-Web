/**
 * Hàm và hằng số dùng chung giữa các module trong claude-meta.
 *
 * Tách ra để tránh circular dependency giữa models.ts, agents.ts, commands.ts, mcp.ts.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

// Đường dẫn cấu hình Claude CLI
export const CLAUDE_HOME = path.join(os.homedir(), '.claude');
export const SETTINGS_FILE = path.join(CLAUDE_HOME, 'settings.json');
export const PLUGINS_DIR = path.join(CLAUDE_HOME, 'plugins');
// File chứa mcpServers, project state, v.v.
export const CLAUDE_JSON_FILE = path.join(os.homedir(), '.claude.json');

// ============================
// Types chung
// ============================
export type AgentScope = 'user' | 'project' | 'local';

/**
 * Cấu trúc frontmatter đầy đủ của file agent .md.
 * Dựa trên tài liệu: https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields
 */
export interface AgentFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  tools?: string[];
  disallowedTools?: string[];
  permissionMode?: string;
  maxTurns?: number;
  skills?: string[];
  mcpServers?: any;
  hooks?: any;
  /** Scope bộ nhớ: user | project | local */
  memory?: string;
  background?: boolean;
  effort?: string;
  isolation?: string;
  color?: string;
  initialPrompt?: string;
}

/**
 * Thông tin agent đầy đủ — dùng cho cả API trả về và nội bộ.
 */
export interface AgentDefinition {
  /** Tên agent (từ frontmatter hoặc filename) */
  name: string;
  /** Tên file gốc (vd: code-reviewer.md) */
  filename: string;
  /** Scope: user (~/.claude/agents), project (.claude/agents), local (agents/) */
  scope: AgentScope;
  /** Đường dẫn tuyệt đối đến file */
  filePath: string;
  /** Frontmatter đã parse */
  frontmatter: AgentFrontmatter;
}

export interface SlashCommand {
  /** Tên lệnh, ví dụ: /commit */
  cmd: string;
  /** Mô tả ngắn */
  desc: string;
  /** Nguồn gốc: 'builtin' hoặc tên plugin */
  source: string;
}

// ============================
// Đọc settings.json của Claude CLI
// ============================
export function readSettings(): Record<string, any> | null {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null;
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Đọc nội dung ~/.claude.json.
 * Trả về object đã parse, hoặc {} nếu file không tồn tại.
 */
export function readClaudeJson(): Record<string, any> {
  try {
    if (!fs.existsSync(CLAUDE_JSON_FILE)) return {};
    return JSON.parse(fs.readFileSync(CLAUDE_JSON_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Parse YAML frontmatter từ file .md agent.
 * Hỗ trợ đầy đủ các field theo tài liệu Claude Code.
 * Không dùng thư viện ngoài — parse thủ công vì frontmatter agent đơn giản (flat YAML, không nested deep).
 */
export function parseFrontmatter(filePath: string): AgentFrontmatter {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};
    const raw = match[1];
    const result: AgentFrontmatter = {};

    // Parse từng dòng — xử lý key: value đơn giản
    const lines = raw.split('\n');
    for (const line of lines) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      const [, key, val] = kv;
      const trimVal = val.trim();

      switch (key) {
        case 'name': result.name = trimVal; break;
        case 'description': result.description = trimVal; break;
        case 'model': result.model = trimVal; break;
        case 'permissionMode': result.permissionMode = trimVal; break;
        case 'memory': result.memory = trimVal; break;
        case 'effort': result.effort = trimVal; break;
        case 'isolation': result.isolation = trimVal; break;
        case 'color': result.color = trimVal; break;
        case 'initialPrompt': result.initialPrompt = trimVal; break;
        case 'maxTurns': result.maxTurns = parseInt(trimVal) || undefined; break;
        case 'background':
          result.background = trimVal === 'true';
          break;
        // Danh sách dạng CSV inline: "tools: Read, Grep, Glob"
        case 'tools':
          result.tools = trimVal.split(',').map(t => t.trim()).filter(Boolean);
          break;
        case 'disallowedTools':
          result.disallowedTools = trimVal.split(',').map(t => t.trim()).filter(Boolean);
          break;
        case 'skills':
          result.skills = trimVal.split(',').map(t => t.trim()).filter(Boolean);
          break;
        // hooks, mcpServers: quá phức tạp để parse inline → lưu raw string, frontend hiển thị badge
        case 'hooks': result.hooks = trimVal || true; break;
        case 'mcpServers': result.mcpServers = trimVal || true; break;
      }
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Wrapper tương thích ngược — chỉ trả description.
 * Dùng cho các hàm cũ (scanPluginCommands, scanCustomCommands) vốn chỉ cần description.
 */
export function parseDescription(filePath: string): string {
  return parseFrontmatter(filePath).description || '';
}
