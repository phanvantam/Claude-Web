import { Router } from 'express';
import {
  getAllCommands,
  getAllModels,
  getCurrentModel,
  getRawSettings,
  updateRawSettings,
  getMcpServers,
  updateMcpServers,
  getMcpServersDetailed,
  updateProjectMcpServers,
  listAgents,
  getAgent,
  saveAgent,
  createAgent,
  deleteAgent,
} from '../services/claude-meta';
import { getProject } from '../services/project';

const router = Router();

/**
 * GET /api/claude/commands — Danh sách slash commands (builtin + plugin).
 */
router.get('/commands', (_req, res) => {
  try {
    const commands = getAllCommands();
    res.json(commands);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/claude/models — Danh sách models khả dụng.
 */
router.get('/models', (_req, res) => {
  try {
    const models = getAllModels();
    const current = getCurrentModel();
    res.json({ models, current });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/claude/settings/raw — Đọc nội dung gốc ~/.claude/settings.json.
 */
router.get('/settings/raw', (_req, res) => {
  try {
    const raw = getRawSettings();
    res.json({ content: raw });
  } catch (error: any) {
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
    updateRawSettings(content);
    res.json({ success: true });
  } catch (error: any) {
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
    const projectId = req.query.projectId as string;
    let projectPath: string | undefined;

    if (projectId) {
      const project = getProject(projectId);
      if (project) {
        projectPath = project.path;
      }
    }

    const raw = getMcpServers(projectPath);
    res.json({ content: raw });
  } catch (error: any) {
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
    updateMcpServers(content);
    res.json({ success: true });
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      res.status(400).json({ error: `JSON không hợp lệ: ${error.message}` });
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/claude/mcp/detailed — MCP servers tách biệt: global + project.
 * Query: projectId (optional) — resolve sang projectPath qua DB.
 */
router.get('/mcp/detailed', (req, res) => {
  try {
    const projectId = req.query.projectId as string;
    let projectPath: string | undefined;

    if (projectId) {
      const project = getProject(projectId);
      if (project) projectPath = project.path;
    }

    const result = getMcpServersDetailed(projectPath);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/claude/mcp/project-servers — Ghi MCP servers per-project.
 * Body: { projectId: string, content: string }
 */
router.post('/mcp/project-servers', (req, res) => {
  try {
    const { projectId, content } = req.body;
    if (!projectId || typeof content !== 'string') {
      res.status(400).json({ error: 'projectId và content (JSON string) là bắt buộc' });
      return;
    }

    const project = getProject(projectId);
    if (!project) {
      res.status(404).json({ error: 'Không tìm thấy dự án' });
      return;
    }

    updateProjectMcpServers(project.path, content);
    res.json({ success: true });
  } catch (error: any) {
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
    res.json(listAgents());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /api/claude/agents/:filename — Đọc nội dung agent */
router.get('/agents/:filename', (req, res) => {
  try {
    const content = getAgent(req.params.filename);
    res.json({ content });
  } catch (error: any) {
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
    saveAgent(req.params.filename, content);
    res.json({ success: true });
  } catch (error: any) {
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
    const filename = createAgent(name);
    res.json({ filename });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

/** DELETE /api/claude/agents/:filename — Xóa agent */
router.delete('/agents/:filename', (req, res) => {
  try {
    deleteAgent(req.params.filename);
    res.json({ success: true });
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

export default router;
