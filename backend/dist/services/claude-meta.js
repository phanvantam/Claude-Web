"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllCommands = getAllCommands;
exports.getAllModels = getAllModels;
exports.getCurrentModel = getCurrentModel;
exports.getRawSettings = getRawSettings;
exports.updateRawSettings = updateRawSettings;
exports.listAgents = listAgents;
exports.getAgent = getAgent;
exports.saveAgent = saveAgent;
exports.createAgent = createAgent;
exports.deleteAgent = deleteAgent;
exports.getMcpServers = getMcpServers;
exports.updateMcpServers = updateMcpServers;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
// Đường dẫn cấu hình Claude CLI
const CLAUDE_HOME = path_1.default.join(os_1.default.homedir(), '.claude');
const SETTINGS_FILE = path_1.default.join(CLAUDE_HOME, 'settings.json');
const PLUGINS_DIR = path_1.default.join(CLAUDE_HOME, 'plugins');
// File chứa mcpServers, project state, v.v.
const CLAUDE_JSON_FILE = path_1.default.join(os_1.default.homedir(), '.claude.json');
// ============================
// Builtin slash commands — luôn có sẵn trong Claude CLI
// ============================
// Chỉ giữ các lệnh có thể xử lý tĩnh trên Web App.
// Các lệnh CLI-only (vim, login, logout, bug, doctor, init, review, permissions)
// đã bị loại bỏ vì không thể hoạt động khi gọi qua SDK.
const BUILTIN_COMMANDS = [
    { cmd: '/clear', desc: 'Tạo cuộc hội thoại mới (xoá lịch sử)', source: 'builtin' },
    { cmd: '/compact', desc: 'Nén ngữ cảnh hội thoại (chưa hỗ trợ)', source: 'builtin' },
    { cmd: '/cost', desc: 'Hiển thị chi phí & token phiên hiện tại', source: 'builtin' },
    { cmd: '/help', desc: 'Danh sách lệnh khả dụng', source: 'builtin' },
    { cmd: '/model', desc: 'Xem model đang sử dụng', source: 'builtin' },
    { cmd: '/status', desc: 'Trạng thái phiên hiện tại', source: 'builtin' },
];
// Builtin model aliases — luôn có sẵn
const BUILTIN_MODELS = [
    { key: 'sonnet', label: 'Sonnet' },
    { key: 'opus', label: 'Opus' },
    { key: 'haiku', label: 'Haiku' },
];
// ============================
// Đọc settings.json của Claude CLI
// ============================
function readSettings() {
    try {
        if (!fs_1.default.existsSync(SETTINGS_FILE))
            return null;
        return JSON.parse(fs_1.default.readFileSync(SETTINGS_FILE, 'utf-8'));
    }
    catch {
        return null;
    }
}
/**
 * Đọc description từ YAML frontmatter trong file .md.
 * Format: ---\ndescription: ...\n---
 */
function parseDescription(filePath) {
    try {
        const content = fs_1.default.readFileSync(filePath, 'utf-8');
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match)
            return '';
        const frontmatter = match[1];
        const descMatch = frontmatter.match(/description:\s*(.+)/i);
        return descMatch ? descMatch[1].trim() : '';
    }
    catch {
        return '';
    }
}
/**
 * Scan thư mục commands/ của các plugin đã bật.
 * Trả về danh sách slash commands từ plugins.
 */
function scanPluginCommands() {
    const settings = readSettings();
    if (!settings)
        return [];
    const enabledPlugins = settings.enabledPlugins || {};
    const commands = [];
    // Duyệt cả marketplaces và cache
    const searchDirs = [
        path_1.default.join(PLUGINS_DIR, 'marketplaces'),
        path_1.default.join(PLUGINS_DIR, 'cache'),
    ];
    for (const baseDir of searchDirs) {
        if (!fs_1.default.existsSync(baseDir))
            continue;
        // Tìm tất cả thư mục commands/ đệ quy
        findCommandDirs(baseDir, (cmdDir, pluginName) => {
            // Kiểm tra plugin có được bật không
            const isEnabled = Object.entries(enabledPlugins).some(([key, val]) => val === true && pluginName.includes(key.split('@')[0]));
            if (!isEnabled)
                return;
            try {
                const files = fs_1.default.readdirSync(cmdDir);
                for (const file of files) {
                    if (!file.endsWith('.md') || file === 'CLAUDE.md')
                        continue;
                    const cmdName = '/' + file.replace('.md', '');
                    const desc = parseDescription(path_1.default.join(cmdDir, file));
                    commands.push({
                        cmd: cmdName,
                        desc: desc || pluginName,
                        source: pluginName,
                    });
                }
            }
            catch { /* bỏ qua lỗi đọc thư mục */ }
        });
    }
    return commands;
}
/**
 * Tìm đệ quy các thư mục tên "commands" trong baseDir.
 */
function findCommandDirs(dir, callback, depth = 0) {
    if (depth > 6)
        return; // Giới hạn đệ quy
    try {
        const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const fullPath = path_1.default.join(dir, entry.name);
            if (entry.name === 'commands') {
                // Lấy tên plugin từ parent directory
                const pluginName = path_1.default.basename(dir);
                callback(fullPath, pluginName);
            }
            else if (entry.name !== 'node_modules' && entry.name !== '.git') {
                findCommandDirs(fullPath, callback, depth + 1);
            }
        }
    }
    catch { /* bỏ qua lỗi permission */ }
}
// ============================
// Public API
// ============================
/**
 * Lấy toàn bộ slash commands — builtin + plugin.
 * Loại trùng lặp theo cmd name (builtin ưu tiên).
 */
function getAllCommands() {
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
        if (a.source === 'builtin' && b.source !== 'builtin')
            return -1;
        if (a.source !== 'builtin' && b.source === 'builtin')
            return 1;
        return a.cmd.localeCompare(b.cmd);
    });
}
/**
 * Lấy danh sách models — builtin aliases + custom từ settings.
 */
function getAllModels() {
    const settings = readSettings();
    const env = settings?.env || {};
    const models = [];
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
function getCurrentModel() {
    const settings = readSettings();
    return settings?.model || 'sonnet';
}
/**
 * Đọc nội dung raw (chuỗi JSON) của ~/.claude/settings.json.
 * Trả về '{}' nếu file không tồn tại.
 */
function getRawSettings() {
    try {
        if (!fs_1.default.existsSync(SETTINGS_FILE))
            return '{}';
        return fs_1.default.readFileSync(SETTINGS_FILE, 'utf-8');
    }
    catch {
        return '{}';
    }
}
/**
 * Ghi nội dung JSON vào ~/.claude/settings.json.
 * Validate cú pháp JSON trước khi lưu — throw lỗi nếu sai.
 */
function updateRawSettings(rawJson) {
    // Validate JSON trước khi ghi — tránh phá file
    const parsed = JSON.parse(rawJson);
    const formatted = JSON.stringify(parsed, null, 2);
    // Tạo thư mục nếu chưa có
    if (!fs_1.default.existsSync(CLAUDE_HOME)) {
        fs_1.default.mkdirSync(CLAUDE_HOME, { recursive: true });
    }
    fs_1.default.writeFileSync(SETTINGS_FILE, formatted, 'utf-8');
}
// ============================
// Agents — ~/.claude/agents/*.md
// ============================
const AGENTS_DIR = path_1.default.join(CLAUDE_HOME, 'agents');
/**
 * Lấy danh sách agent files (.md) trong ~/.claude/agents/.
 */
function listAgents() {
    try {
        if (!fs_1.default.existsSync(AGENTS_DIR))
            return [];
        const files = fs_1.default.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md'));
        return files.map(f => ({
            name: f.replace('.md', ''),
            filename: f,
        }));
    }
    catch {
        return [];
    }
}
/**
 * Đọc nội dung một agent file.
 */
function getAgent(filename) {
    const filePath = path_1.default.join(AGENTS_DIR, filename);
    if (!fs_1.default.existsSync(filePath))
        throw new Error(`Agent không tồn tại: ${filename}`);
    return fs_1.default.readFileSync(filePath, 'utf-8');
}
/**
 * Ghi nội dung vào agent file. Tạo thư mục nếu chưa có.
 */
function saveAgent(filename, content) {
    if (!fs_1.default.existsSync(AGENTS_DIR)) {
        fs_1.default.mkdirSync(AGENTS_DIR, { recursive: true });
    }
    fs_1.default.writeFileSync(path_1.default.join(AGENTS_DIR, filename), content, 'utf-8');
}
/**
 * Tạo agent file mới.
 */
function createAgent(name) {
    const filename = name.endsWith('.md') ? name : `${name}.md`;
    const filePath = path_1.default.join(AGENTS_DIR, filename);
    if (fs_1.default.existsSync(filePath))
        throw new Error(`Agent đã tồn tại: ${filename}`);
    if (!fs_1.default.existsSync(AGENTS_DIR)) {
        fs_1.default.mkdirSync(AGENTS_DIR, { recursive: true });
    }
    const template = `---
description: ${name.replace('.md', '')}
---

# ${name.replace('.md', '')}

`;
    fs_1.default.writeFileSync(filePath, template, 'utf-8');
    return filename;
}
/**
 * Xóa agent file.
 */
function deleteAgent(filename) {
    const filePath = path_1.default.join(AGENTS_DIR, filename);
    if (!fs_1.default.existsSync(filePath))
        throw new Error(`Agent không tồn tại: ${filename}`);
    fs_1.default.unlinkSync(filePath);
}
/**
 * Đọc nội dung ~/.claude.json.
 * Trả về object đã parse, hoặc {} nếu file không tồn tại.
 */
function readClaudeJson() {
    try {
        if (!fs_1.default.existsSync(CLAUDE_JSON_FILE))
            return {};
        return JSON.parse(fs_1.default.readFileSync(CLAUDE_JSON_FILE, 'utf-8'));
    }
    catch {
        return {};
    }
}
/**
 * Lấy cấu hình mcpServers (JSON string đã format).
 * Hỗ trợ trộn cả ~/.claude.json và <projectPath>/.mcp.json (nếu có).
 */
function getMcpServers(projectPath) {
    const globalData = readClaudeJson();
    let servers = globalData.mcpServers || {};
    if (projectPath) {
        try {
            const localFsPath = path_1.default.join(projectPath, '.mcp.json');
            if (fs_1.default.existsSync(localFsPath)) {
                const localData = JSON.parse(fs_1.default.readFileSync(localFsPath, 'utf-8'));
                if (localData.mcpServers) {
                    servers = { ...servers, ...localData.mcpServers };
                }
            }
        }
        catch {
            // Bỏ qua nếu lỗi đọc file local
        }
    }
    return JSON.stringify(servers, null, 2);
}
/**
 * Cập nhật mcpServers trong ~/.claude.json.
 * Chỉ ghi đè trường mcpServers, giữ nguyên toàn bộ dữ liệu khác.
 */
function updateMcpServers(rawJson) {
    // Validate cú pháp JSON
    const parsed = JSON.parse(rawJson);
    const data = readClaudeJson();
    data.mcpServers = parsed;
    fs_1.default.writeFileSync(CLAUDE_JSON_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
//# sourceMappingURL=claude-meta.js.map