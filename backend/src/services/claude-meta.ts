import fs from 'fs';
import path from 'path';
import os from 'os';

// Đường dẫn cấu hình Claude CLI
const CLAUDE_HOME = path.join(os.homedir(), '.claude');
const SETTINGS_FILE = path.join(CLAUDE_HOME, 'settings.json');
const PLUGINS_DIR = path.join(CLAUDE_HOME, 'plugins');
// File chứa mcpServers, project state, v.v.
const CLAUDE_JSON_FILE = path.join(os.homedir(), '.claude.json');

// ============================
// Types
// ============================
export interface SlashCommand {
  /** Tên lệnh, ví dụ: /commit */
  cmd: string;
  /** Mô tả ngắn */
  desc: string;
  /** Nguồn gốc: 'builtin' hoặc tên plugin */
  source: string;
}

export interface ModelInfo {
  /** Key/alias, ví dụ: 'sonnet' */
  key: string;
  /** Tên hiển thị */
  label: string;
  /** Model ID thực tế nếu có (từ settings env) */
  modelId?: string;
}

// ============================
// Builtin slash commands — luôn có sẵn trong Claude CLI
// ============================
// Chỉ giữ các lệnh có thể xử lý tĩnh trên Web App.
// Các lệnh CLI-only (vim, login, logout, bug, doctor, init, review, permissions)
// đã bị loại bỏ vì không thể hoạt động khi gọi qua SDK.
const BUILTIN_COMMANDS: SlashCommand[] = [
  { cmd: '/clear', desc: 'Tạo cuộc hội thoại mới (xoá lịch sử)', source: 'builtin' },
  { cmd: '/compact', desc: 'Nén ngữ cảnh hội thoại (chưa hỗ trợ)', source: 'builtin' },
  { cmd: '/cost', desc: 'Hiển thị chi phí & token phiên hiện tại', source: 'builtin' },
  { cmd: '/help', desc: 'Danh sách lệnh khả dụng', source: 'builtin' },
  { cmd: '/model', desc: 'Xem model đang sử dụng', source: 'builtin' },
  { cmd: '/status', desc: 'Trạng thái phiên hiện tại', source: 'builtin' },
];

// Builtin model aliases — luôn có sẵn
const BUILTIN_MODELS: ModelInfo[] = [
  { key: 'sonnet', label: 'Sonnet' },
  { key: 'opus', label: 'Opus' },
  { key: 'haiku', label: 'Haiku' },
];

// ============================
// Đọc settings.json của Claude CLI
// ============================
function readSettings(): Record<string, any> | null {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return null;
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Đọc description từ YAML frontmatter trong file .md.
 * Format: ---\ndescription: ...\n---
 */
function parseDescription(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return '';
    const frontmatter = match[1];
    const descMatch = frontmatter.match(/description:\s*(.+)/i);
    return descMatch ? descMatch[1].trim() : '';
  } catch {
    return '';
  }
}

/**
 * Scan thư mục commands/ của các plugin đã bật.
 * Trả về danh sách slash commands từ plugins.
 */
function scanPluginCommands(): SlashCommand[] {
  const settings = readSettings();
  if (!settings) return [];

  const enabledPlugins = settings.enabledPlugins || {};
  const commands: SlashCommand[] = [];

  // Duyệt cả marketplaces và cache
  const searchDirs = [
    path.join(PLUGINS_DIR, 'marketplaces'),
    path.join(PLUGINS_DIR, 'cache'),
  ];

  for (const baseDir of searchDirs) {
    if (!fs.existsSync(baseDir)) continue;

    // Tìm tất cả thư mục commands/ đệ quy
    findCommandDirs(baseDir, (cmdDir, pluginName) => {
      // Kiểm tra plugin có được bật không
      const isEnabled = Object.entries(enabledPlugins).some(
        ([key, val]) => val === true && pluginName.includes(key.split('@')[0])
      );
      if (!isEnabled) return;

      try {
        const files = fs.readdirSync(cmdDir);
        for (const file of files) {
          if (!file.endsWith('.md') || file === 'CLAUDE.md') continue;
          const cmdName = '/' + file.replace('.md', '');
          const desc = parseDescription(path.join(cmdDir, file));
          commands.push({
            cmd: cmdName,
            desc: desc || pluginName,
            source: pluginName,
          });
        }
      } catch { /* bỏ qua lỗi đọc thư mục */ }
    });
  }

  return commands;
}

/**
 * Tìm đệ quy các thư mục tên "commands" trong baseDir.
 */
function findCommandDirs(
  dir: string,
  callback: (cmdDir: string, pluginName: string) => void,
  depth = 0,
): void {
  if (depth > 6) return; // Giới hạn đệ quy
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.name === 'commands') {
        // Lấy tên plugin từ parent directory
        const pluginName = path.basename(dir);
        callback(fullPath, pluginName);
      } else if (entry.name !== 'node_modules' && entry.name !== '.git') {
        findCommandDirs(fullPath, callback, depth + 1);
      }
    }
  } catch { /* bỏ qua lỗi permission */ }
}

// ============================
// Public API
// ============================

/**
 * Lấy toàn bộ slash commands — builtin + plugin.
 * Loại trùng lặp theo cmd name (builtin ưu tiên).
 */
export function getAllCommands(): SlashCommand[] {
  const pluginCmds = scanPluginCommands();
  const allCmds = [...BUILTIN_COMMANDS];

  // Merge plugin commands, bỏ trùng với builtin
  const builtinNames = new Set(BUILTIN_COMMANDS.map(c => c.cmd));
  for (const cmd of pluginCmds) {
    if (!builtinNames.has(cmd.cmd)) {
      allCmds.push(cmd);
    }
  }

  // Sắp xếp: builtin trước, plugin sau, theo alphabet
  return allCmds.sort((a, b) => {
    if (a.source === 'builtin' && b.source !== 'builtin') return -1;
    if (a.source !== 'builtin' && b.source === 'builtin') return 1;
    return a.cmd.localeCompare(b.cmd);
  });
}

/**
 * Lấy danh sách models — builtin aliases + custom từ settings.
 */
export function getAllModels(): ModelInfo[] {
  const settings = readSettings();
  const env = settings?.env || {};
  const models: ModelInfo[] = [];

  for (const m of BUILTIN_MODELS) {
    // Gắn model ID thực tế từ env nếu có
    const envKey = `ANTHROPIC_DEFAULT_${m.key.toUpperCase()}_MODEL`;
    models.push({
      ...m,
      modelId: env[envKey] || undefined,
    });
  }

  // Nếu settings có model đang dùng khác với builtin aliases, thêm vào
  const currentModel = settings?.model;
  if (currentModel) {
    const baseAlias = currentModel.replace(/\[.*\]/, ''); // Bỏ suffix như [1m]
    if (!models.find(m => m.key === baseAlias)) {
      models.push({ key: currentModel, label: currentModel });
    }
  }

  return models;
}

/**
 * Lấy model đang active từ settings.json.
 */
export function getCurrentModel(): string {
  const settings = readSettings();
  return settings?.model || 'sonnet';
}

/**
 * Đọc nội dung raw (chuỗi JSON) của ~/.claude/settings.json.
 * Trả về '{}' nếu file không tồn tại.
 */
export function getRawSettings(): string {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return '{}';
    return fs.readFileSync(SETTINGS_FILE, 'utf-8');
  } catch {
    return '{}';
  }
}

/**
 * Ghi nội dung JSON vào ~/.claude/settings.json.
 * Validate cú pháp JSON trước khi lưu — throw lỗi nếu sai.
 */
export function updateRawSettings(rawJson: string): void {
  // Validate JSON trước khi ghi — tránh phá file
  const parsed = JSON.parse(rawJson);
  const formatted = JSON.stringify(parsed, null, 2);

  // Tạo thư mục nếu chưa có
  if (!fs.existsSync(CLAUDE_HOME)) {
    fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  }

  fs.writeFileSync(SETTINGS_FILE, formatted, 'utf-8');
}

// ============================
// Agents — ~/.claude/agents/*.md
// ============================
const AGENTS_DIR = path.join(CLAUDE_HOME, 'agents');

/**
 * Lấy danh sách agent files (.md) trong ~/.claude/agents/.
 */
export function listAgents(): { name: string; filename: string }[] {
  try {
    if (!fs.existsSync(AGENTS_DIR)) return [];
    const files = fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'));
    return files.map(f => ({
      name: f.replace('.md', ''),
      filename: f,
    }));
  } catch {
    return [];
  }
}

/**
 * Đọc nội dung một agent file.
 */
export function getAgent(filename: string): string {
  const filePath = path.join(AGENTS_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Agent không tồn tại: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Ghi nội dung vào agent file. Tạo thư mục nếu chưa có.
 */
export function saveAgent(filename: string, content: string): void {
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(AGENTS_DIR, filename), content, 'utf-8');
}

/**
 * Tạo agent file mới.
 */
export function createAgent(name: string): string {
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const filePath = path.join(AGENTS_DIR, filename);
  if (fs.existsSync(filePath)) throw new Error(`Agent đã tồn tại: ${filename}`);
  if (!fs.existsSync(AGENTS_DIR)) {
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
  }
  const template = `---
description: ${name.replace('.md', '')}
---

# ${name.replace('.md', '')}

`;
  fs.writeFileSync(filePath, template, 'utf-8');
  return filename;
}

/**
 * Xóa agent file.
 */
export function deleteAgent(filename: string): void {
  const filePath = path.join(AGENTS_DIR, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Agent không tồn tại: ${filename}`);
  fs.unlinkSync(filePath);
}

/**
 * Đọc nội dung ~/.claude.json.
 * Trả về object đã parse, hoặc {} nếu file không tồn tại.
 */
function readClaudeJson(): Record<string, any> {
  try {
    if (!fs.existsSync(CLAUDE_JSON_FILE)) return {};
    return JSON.parse(fs.readFileSync(CLAUDE_JSON_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

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
