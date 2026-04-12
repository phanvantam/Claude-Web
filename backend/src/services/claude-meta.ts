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

// ============================
// Agent Scope Type — 3 cấp độ theo tài liệu Claude Code
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

/**
 * Parse YAML frontmatter từ file .md agent.
 * Hỗ trợ đầy đủ các field theo tài liệu Claude Code.
 * Không dùng thư viện ngoài — parse thủ công vì frontmatter agent đơn giản (flat YAML, không nested deep).
 */
function parseFrontmatter(filePath: string): AgentFrontmatter {
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
function parseDescription(filePath: string): string {
  return parseFrontmatter(filePath).description || '';
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

/**
 * Scan custom slash commands từ một thư mục commands/.
 * Mỗi file .md = 1 command, tên file = tên lệnh.
 * Description lấy từ YAML frontmatter.
 */
function scanCustomCommandsInDir(dir: string, source: string): SlashCommand[] {
  if (!fs.existsSync(dir)) return [];
  const commands: SlashCommand[] = [];
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith('.md') || file === 'CLAUDE.md') continue;
      const cmdName = '/' + file.replace('.md', '');
      const desc = parseDescription(path.join(dir, file));
      commands.push({
        cmd: cmdName,
        desc: desc || file.replace('.md', ''),
        source,
      });
    }
  } catch { /* bỏ qua lỗi đọc thư mục */ }
  return commands;
}

/**
 * Scan custom commands cả 2 scope: global (~/.claude/commands/) và project (<path>/.claude/commands/).
 */
function scanCustomCommands(projectPath?: string): SlashCommand[] {
  const globalDir = path.join(CLAUDE_HOME, 'commands');
  const results = scanCustomCommandsInDir(globalDir, 'global');

  if (projectPath) {
    const projectDir = path.join(projectPath, '.claude', 'commands');
    results.push(...scanCustomCommandsInDir(projectDir, 'project'));
  }

  return results;
}

// ============================
// Public API
// ============================

/**
 * Lấy toàn bộ slash commands — builtin + plugin + custom (global + project).
 * Loại trùng lặp theo cmd name (builtin > custom > plugin ưu tiên).
 */
export function getAllCommands(projectPath?: string): SlashCommand[] {
  const pluginCmds = scanPluginCommands();
  const customCmds = scanCustomCommands(projectPath);
  const allCmds = [...BUILTIN_COMMANDS];

  // Merge: custom commands trước (ưu tiên hơn plugin)
  const seenNames = new Set(BUILTIN_COMMANDS.map(c => c.cmd));
  for (const cmd of customCmds) {
    if (!seenNames.has(cmd.cmd)) {
      allCmds.push(cmd);
      seenNames.add(cmd.cmd);
    }
  }
  // Merge plugin commands — ưu tiên thấp nhất
  for (const cmd of pluginCmds) {
    if (!seenNames.has(cmd.cmd)) {
      allCmds.push(cmd);
      seenNames.add(cmd.cmd);
    }
  }

  // Sắp xếp: builtin trước, custom, plugin cuối, theo alphabet
  const sourceOrder: Record<string, number> = { builtin: 0, project: 1, global: 2 };
  return allCmds.sort((a, b) => {
    const oa = sourceOrder[a.source] ?? 3;
    const ob = sourceOrder[b.source] ?? 3;
    if (oa !== ob) return oa - ob;
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
// Agents — Multi-scope: user (~/.claude/agents/), project (.claude/agents/), local (agents/)
// Theo tài liệu: https://code.claude.com/docs/en/sub-agents#choose-the-subagent-scope
// ============================
const AGENTS_DIR = path.join(CLAUDE_HOME, 'agents');

/**
 * Quét agent files (.md) trong 1 thư mục cụ thể.
 * Trả về danh sách AgentDefinition kèm scope và frontmatter đầy đủ.
 */
function scanAgentsInDir(dir: string, scope: AgentScope): AgentDefinition[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filePath = path.join(dir, f);
        const fm = parseFrontmatter(filePath);
        return {
          name: fm.name || f.replace('.md', ''),
          filename: f,
          scope,
          filePath,
          frontmatter: fm,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Lấy TOÀN BỘ agents từ 3 scope: user (global), project, local.
 * Thứ tự ưu tiên: local > project > user (theo tài liệu Claude Code).
 * Nếu trùng tên, scope hẹp hơn sẽ ghi đè scope rộng.
 */
export function listAllAgents(projectPath?: string): AgentDefinition[] {
  // 1. User scope: ~/.claude/agents/
  const userAgents = scanAgentsInDir(AGENTS_DIR, 'user');

  // 2. Project scope: <projectPath>/.claude/agents/
  const projectAgents = projectPath
    ? scanAgentsInDir(path.join(projectPath, '.claude', 'agents'), 'project')
    : [];

  // 3. Local scope: <projectPath>/agents/
  const localAgents = projectPath
    ? scanAgentsInDir(path.join(projectPath, 'agents'), 'local')
    : [];

  // Merge — local > project > user (scope hẹp ghi đè rộng)
  const merged = new Map<string, AgentDefinition>();
  for (const agent of userAgents) merged.set(agent.name, agent);
  for (const agent of projectAgents) merged.set(agent.name, agent);
  for (const agent of localAgents) merged.set(agent.name, agent);

  return Array.from(merged.values());
}

/**
 * Tương thích ngược: listAgents() — chỉ quét user scope.
 * Dùng cho các API cũ chưa truyền projectPath.
 */
export function listAgents(): { name: string; filename: string }[] {
  return scanAgentsInDir(AGENTS_DIR, 'user').map(a => ({
    name: a.name,
    filename: a.filename,
  }));
}

/**
 * Tương thích ngược: listAgentsWithDescription().
 * Dùng cho @mention autocomplete — nay đã hỗ trợ scope nếu có projectPath.
 */
export function listAgentsWithDescription(projectPath?: string): {
  name: string; filename: string; description: string; scope: AgentScope;
  model?: string; tools?: string[]; permissionMode?: string;
}[] {
  const agents = projectPath ? listAllAgents(projectPath) : scanAgentsInDir(AGENTS_DIR, 'user');
  return agents.map(a => ({
    name: a.name,
    filename: a.filename,
    description: a.frontmatter.description || '',
    scope: a.scope,
    model: a.frontmatter.model,
    tools: a.frontmatter.tools,
    permissionMode: a.frontmatter.permissionMode,
  }));
}

/**
 * Đọc nội dung một agent file.
 * Hỗ trợ scope: tìm trong user dir, nếu có projectPath thì tìm cả project/local.
 */
export function getAgent(filename: string, projectPath?: string): string {
  // Thử theo thứ tự ưu tiên scope: local > project > user
  if (projectPath) {
    const localPath = path.join(projectPath, 'agents', filename);
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath, 'utf-8');
    const projPath = path.join(projectPath, '.claude', 'agents', filename);
    if (fs.existsSync(projPath)) return fs.readFileSync(projPath, 'utf-8');
  }
  const userPath = path.join(AGENTS_DIR, filename);
  if (fs.existsSync(userPath)) return fs.readFileSync(userPath, 'utf-8');
  throw new Error(`Agent không tồn tại: ${filename}`);
}

/**
 * Ghi nội dung vào agent file.
 * scope = 'user' → ~/.claude/agents/, 'project' → <projectPath>/.claude/agents/
 */
export function saveAgent(filename: string, content: string, scope: AgentScope = 'user', projectPath?: string): void {
  const dir = resolveAgentDir(scope, projectPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

/**
 * Tạo agent file mới với template chứa các field cấu hình gợi ý.
 */
export function createAgent(name: string, scope: AgentScope = 'user', projectPath?: string): string {
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const dir = resolveAgentDir(scope, projectPath);
  const filePath = path.join(dir, filename);
  if (fs.existsSync(filePath)) throw new Error(`Agent đã tồn tại: ${filename}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Template gợi ý các field frontmatter phổ biến — giúp lập trình viên nhanh chóng cấu hình
  const safeName = name.replace('.md', '');
  const template = `---
name: ${safeName}
description: Mô tả ngắn về agent ${safeName}
model: inherit
tools: Read, Grep, Glob, Bash
# permissionMode: default
# memory: project
# background: false
---

Bạn là agent chuyên biệt "${safeName}". Khi được gọi, hãy thực hiện nhiệm vụ theo mô tả ở trên.
`;
  fs.writeFileSync(filePath, template, 'utf-8');
  return filename;
}

/**
 * Xóa agent file.
 */
export function deleteAgent(filename: string, scope: AgentScope = 'user', projectPath?: string): void {
  const dir = resolveAgentDir(scope, projectPath);
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Agent không tồn tại: ${filename}`);
  fs.unlinkSync(filePath);
}

/**
 * Resolve thư mục agents theo scope.
 */
function resolveAgentDir(scope: AgentScope, projectPath?: string): string {
  switch (scope) {
    case 'project':
      if (!projectPath) throw new Error('projectPath bắt buộc khi scope = project');
      return path.join(projectPath, '.claude', 'agents');
    case 'local':
      if (!projectPath) throw new Error('projectPath bắt buộc khi scope = local');
      return path.join(projectPath, 'agents');
    case 'user':
    default:
      return AGENTS_DIR;
  }
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

// ============================
// Custom Slash Commands — ~/.claude/commands/ + <project>/.claude/commands/
// ============================

/** Resolve đường dẫn thư mục commands theo scope */
function resolveCommandsDir(scope: 'global' | 'project', projectPath?: string): string {
  if (scope === 'project') {
    if (!projectPath) throw new Error('projectPath bắt buộc khi scope = project');
    return path.join(projectPath, '.claude', 'commands');
  }
  return path.join(CLAUDE_HOME, 'commands');
}

/**
 * Liệt kê custom commands theo scope.
 * Trả về danh sách file .md kèm description đã parse.
 */
export function listCustomCommands(
  scope: 'global' | 'project',
  projectPath?: string,
): { filename: string; name: string; desc: string }[] {
  const dir = resolveCommandsDir(scope, projectPath);
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md') && f !== 'CLAUDE.md')
      .map(f => ({
        filename: f,
        name: f.replace('.md', ''),
        desc: parseDescription(path.join(dir, f)),
      }));
  } catch {
    return [];
  }
}

/**
 * Đọc nội dung một custom command file.
 */
export function getCustomCommand(
  scope: 'global' | 'project',
  filename: string,
  projectPath?: string,
): string {
  const dir = resolveCommandsDir(scope, projectPath);
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Command không tồn tại: ${filename}`);
  return fs.readFileSync(filePath, 'utf-8');
}

/**
 * Tạo hoặc cập nhật custom command file.
 * Tự tạo thư mục nếu chưa có.
 */
export function saveCustomCommand(
  scope: 'global' | 'project',
  filename: string,
  content: string,
  projectPath?: string,
): void {
  const dir = resolveCommandsDir(scope, projectPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // Đảm bảo filename kết thúc bằng .md
  const safeName = filename.endsWith('.md') ? filename : `${filename}.md`;
  fs.writeFileSync(path.join(dir, safeName), content, 'utf-8');
}

/**
 * Xóa custom command file.
 */
export function deleteCustomCommand(
  scope: 'global' | 'project',
  filename: string,
  projectPath?: string,
): void {
  const dir = resolveCommandsDir(scope, projectPath);
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Command không tồn tại: ${filename}`);
  fs.unlinkSync(filePath);
}
