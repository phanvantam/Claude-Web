"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const session_1 = require("../services/session");
const claude_1 = require("../services/claude");
const router = (0, express_1.Router)();
/**
 * GET /api/sessions/active — Lấy danh sách sessionId đang xử lý.
 * Dùng cho Sidebar hiển thị trạng thái khi vừa mở lại trang.
 * Lưu ý: route này phải đặt TRƯỚC /:id để không bị match sai.
 */
router.get('/active', (_req, res) => {
    try {
        const processing = claude_1.claudeService.getProcessingSessions();
        res.json({ processing });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/sessions — Lấy danh sách tất cả sessions (không kèm messages).
 */
router.get('/', (_req, res) => {
    try {
        const sessions = (0, session_1.getAllSessions)();
        res.json(sessions);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * GET /api/sessions/:id — Lấy metadata session theo ID (không kèm messages).
 */
router.get('/:id', (req, res) => {
    try {
        const session = (0, session_1.getSession)(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        // Trả session không kèm messages — frontend sẽ gọi endpoint riêng
        const { messages, ...sessionMeta } = session;
        res.json(sessionMeta);
    }
    catch (error) {
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
        const result = (0, session_1.getMessagesPaginated)(sessionId, cursor, limit);
        const totalCount = (0, session_1.getMessageCount)(sessionId);
        res.json({ ...result, totalCount });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
/**
 * DELETE /api/sessions/:id — Xoá session và toàn bộ messages.
 */
router.delete('/:id', (req, res) => {
    try {
        const success = (0, session_1.deleteSession)(req.params.id);
        if (!success) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.status(204).send();
    }
    catch (error) {
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
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
//# sourceMappingURL=sessions.js.map