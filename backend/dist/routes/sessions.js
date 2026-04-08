"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const session_1 = require("../services/session");
const router = (0, express_1.Router)();
// GET all sessions
router.get('/', (_req, res) => {
    try {
        const sessions = (0, session_1.getAllSessions)();
        res.json(sessions);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// GET session by ID
router.get('/:id', (req, res) => {
    try {
        const session = (0, session_1.getSession)(req.params.id);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json(session);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// DELETE session by ID
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
exports.default = router;
//# sourceMappingURL=sessions.js.map