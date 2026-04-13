/**
 * Quản lý slash commands: builtin, plugin, và custom commands.
 *
 * Tách từ claude-meta.ts — nhóm các hàm liên quan đến command discovery
 * (scan plugin, scan custom, get/save/delete commands).
 */

import fs from 'fs';
import path from 'path';
import {
  CLAUDE_HOME, PLUGINS_DIR,
  readSettings, parseDescription,
  SlashCommand,
} from './shared';

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
