import { Router } from 'express';
import { getAllSessions, getSession, deleteSession, getMessagesPaginated, getMessageCount } from '../services/session';
import { claudeService } from '../services/claude';

const router = Router();

/**
 * GET /api/sessions/active — Lấy danh sách sessionId đang xử lý.
 * Dùng cho Sidebar hiển thị trạng thái khi vừa mở lại trang.
 * Lưu ý: route này phải đặt TRƯỚC /:id để không bị match sai.
 */
router.get('/active', (_req, res) => {
  try {
    const processing = claudeService.getProcessingSessions();
    res.json({ processing });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sessions/:id/status — Trả isProcessing realtime.
 * Dùng làm fallback khi WebSocket event bị mất qua nginx proxy.
 */
router.get('/:id/status', (req, res) => {
  try {
    const state = claudeService.getSessionState(req.params.id);
    res.json({ isProcessing: state?.isProcessing ?? false });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sessions/:id/subagents — Danh sách sub-agents đã chạy trong session.
 * Đọc từ filesystem: ~/.claude/projects/<encoded-cwd>/<sessionId>/subagents/
 * Lưu ý: route cụ thể này phải đặt TRƯỚC /:id generic để Express match đúng.
 */
router.get('/:id/subagents', (req, res) => {
  try {
    const agents = claudeService.listSubAgents(req.params.id);
    res.json(agents);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sessions/:id/subagents/:agentId/timeline — Timeline events của sub-agent.
 * Parse file .jsonl để trích xuất thinking, tool_use, tool_result, text.
 */
router.get('/:id/subagents/:agentId/timeline', (req, res) => {
  try {
    const events = claudeService.getSubAgentTimeline(req.params.id, req.params.agentId);
    res.json(events);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sessions — Lấy danh sách tất cả sessions (không kèm messages).
 */
router.get('/', (_req, res) => {
  try {
    const sessions = getAllSessions();
    res.json(sessions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sessions/:id — Lấy metadata session theo ID (không kèm messages).
 */
router.get('/:id', (req, res) => {
  try {
    const session = getSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    // Trả session không kèm messages — frontend sẽ gọi endpoint riêng
    const { messages, ...sessionMeta } = session;
    res.json(sessionMeta);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/sessions/:id/messages — Lấy messages phân trang (cursor-based).
 * Query params:
 *   - cursor (number, tuỳ chọn): sort_order tối đa, lấy messages cũ hơn
 *   - limit (number, mặc định 20): số lượng messages mỗi trang
 * Response: { messages: ChatMessage[], nextCursor: number | null, hasMore: boolean, totalCount: number }
 */
router.get('/:id/messages', (req, res) => {
  try {
    const sessionId = req.params.id;
    const cursor = req.query.cursor ? Number(req.query.cursor) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const result = getMessagesPaginated(sessionId, cursor, limit);
    const totalCount = getMessageCount(sessionId);

    res.json({ ...result, totalCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/sessions/:id — Xoá session và toàn bộ messages.
 * Thứ tự:
 *  1. stopSession nếu đang active → interrupt CLI process + emit session:ended
 *  2. xoá khỏi DB (cascade → messages)
 *  3. emit session:deleted → thông báo tất cả client đang mở session này
 */
router.delete('/:id', (req, res) => {
  try {
    const sessionId = req.params.id;
    const savedSession = getSession(sessionId);
    if (!savedSession) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 1. Dừng CLI process nếu session đang active (tránh orphan process)
    if (claudeService.isSessionActive(sessionId)) {
      claudeService.stopSession(sessionId);
    }

    // 2. Xoá dữ liệu Claude CLI (file hội thoại + thư mục subagents)
    // DB app và storage CLI là hai hệ thống tách biệt — cần dọn cả hai.
    const { getProject } = require('../services/project');
    const { getEncodedCwd } = require('../services/claude/utils');
    const os = require('os');
    const path = require('path');
    const fs = require('fs');

    const project = getProject(savedSession.projectId);
    if (project?.path) {
      const encodedCwd = getEncodedCwd(project.path);
      const cliProjectsDir = path.join(os.homedir(), '.claude', 'projects', encodedCwd);
      const cliSessionFile = path.join(cliProjectsDir, `${savedSession.sessionId}.jsonl`);
      const cliSessionDir = path.join(cliProjectsDir, savedSession.sessionId);

      if (fs.existsSync(cliSessionFile)) {
        fs.rmSync(cliSessionFile, { force: true });
      }
      if (fs.existsSync(cliSessionDir)) {
        fs.rmSync(cliSessionDir, { recursive: true, force: true });
      }
    }

    // 3. Xoá khỏi DB — cascade FK tự động xoá messages
    const success = deleteSession(sessionId);
    if (!success) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // 4. Emit socket event để các client khác biết session đã bị xoá
    const { getIo } = require('../socket/io');
    const io = getIo();
    if (io) {
      io.to(sessionId).emit('session:deleted', { sessionId });
      io.emit('global:session_status', { sessionId, status: 'deleted' });
    }

    res.status(204).send();
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/sessions/:id — Cập nhật metadata session (ví dụ: đổi model).
 */
router.patch('/:id', (req, res) => {
  try {
    const { updateSession } = require('../services/session');
    updateSession(req.params.id, req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
