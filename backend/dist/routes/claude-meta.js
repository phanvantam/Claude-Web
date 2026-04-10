"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const claude_meta_1 = require("../services/claude-meta");
const project_1 = require("../services/project");
const router = (0, express_1.Router)();
/**
 * GET /api/claude/commands — Danh sách slash commands (builtin + plugin).
 */
router.get('/commands', (_req, res) => {
    try {
        const commands = (0, claude_meta_1.getAllCommands)();
        res.json(commands);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/claude/models — Danh sách models khả dụng.
 */
router.get('/models', (_req, res) => {
    try {
        const models = (0, claude_meta_1.getAllModels)();
        const current = (0, claude_meta_1.getCurrentModel)();
        res.json({ models, current });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/claude/settings/raw — Đọc nội dung gốc ~/.claude/settings.json.
 */
router.get('/settings/raw', (_req, res) => {
    try {
        const raw = (0, claude_meta_1.getRawSettings)();
        res.json({ content: raw });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/claude/settings/raw — Ghi nội dung vào ~/.claude/settings.json.
 * Body: { content: string } — chuỗi JSON hợp lệ.
 */
router.post('/settings/raw', (req, res) => {
    try {
        const { content } = req.body;
        if (typeof content !== 'string') {
            res.status(400).json({ error: 'Trường "content" phải là chuỗi JSON' });
            return;
        }
        (0, claude_meta_1.updateRawSettings)(content);
        res.json({ success: true });
    }
    catch (error) {
        // JSON.parse failed → lỗi cú pháp
        if (error instanceof SyntaxError) {
            res.status(400).json({ error: `JSON không hợp lệ: ${error.message}` });
            return;
        }
        res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/claude/mcp/servers — Đọc cấu hình mcpServers từ ~/.claude.json và <projectPath>/.mcp.json (nếu có projectId).
 */
router.get('/mcp/servers', (req, res) => {
    try {
        const projectId = req.query.projectId;
        let projectPath;
        if (projectId) {
            const project = (0, project_1.getProject)(projectId);
            if (project) {
                projectPath = project.path;
            }
        }
        const raw = (0, claude_meta_1.getMcpServers)(projectPath);
        res.json({ content: raw });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/claude/mcp/servers — Ghi cấu hình mcpServers vào ~/.claude.json.
 * Body: { content: string } — JSON object chứa danh sách servers.
 */
router.post('/mcp/servers', (req, res) => {
    try {
        const { content } = req.body;
        if (typeof content !== 'string') {
            res.status(400).json({ error: 'Trường "content" phải là chuỗi JSON' });
            return;
        }
        (0, claude_meta_1.updateMcpServers)(content);
        res.json({ success: true });
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            res.status(400).json({ error: `JSON không hợp lệ: ${error.message}` });
            return;
        }
        res.status(500).json({ error: error.message });
    }
});
// ============================
// Agents — ~/.claude/agents/*.md
// ============================
/** GET /api/claude/agents — Danh sách agent files */
router.get('/agents', (_req, res) => {
    try {
        res.json((0, claude_meta_1.listAgents)());
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/** GET /api/claude/agents/:filename — Đọc nội dung agent */
router.get('/agents/:filename', (req, res) => {
    try {
        const content = (0, claude_meta_1.getAgent)(req.params.filename);
        res.json({ content });
    }
    catch (error) {
        res.status(404).json({ error: error.message });
    }
});
/** PUT /api/claude/agents/:filename — Cập nhật nội dung agent */
router.put('/agents/:filename', (req, res) => {
    try {
        const { content } = req.body;
        if (typeof content !== 'string') {
            res.status(400).json({ error: 'Trường "content" phải là chuỗi' });
            return;
        }
        (0, claude_meta_1.saveAgent)(req.params.filename, content);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/** POST /api/claude/agents — Tạo agent mới */
router.post('/agents', (req, res) => {
    try {
        const { name } = req.body;
        if (!name || typeof name !== 'string') {
            res.status(400).json({ error: 'Trường "name" là bắt buộc' });
            return;
        }
        const filename = (0, claude_meta_1.createAgent)(name);
        res.json({ filename });
    }
    catch (error) {
        res.status(400).json({ error: error.message });
    }
});
/** DELETE /api/claude/agents/:filename — Xóa agent */
router.delete('/agents/:filename', (req, res) => {
    try {
        (0, claude_meta_1.deleteAgent)(req.params.filename);
        res.json({ success: true });
    }
    catch (error) {
        res.status(404).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=claude-meta.js.map