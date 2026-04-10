"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const projects_1 = __importDefault(require("./routes/projects"));
const config_1 = __importDefault(require("./routes/config"));
const sessions_1 = __importDefault(require("./routes/sessions"));
const claude_meta_1 = __importDefault(require("./routes/claude-meta"));
const claude_1 = require("./services/claude");
const logger_1 = require("./services/logger");
const PORT = process.env.PORT || 3001;
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: ['http://localhost:5173', 'http://localhost:3000'],
        methods: ['GET', 'POST'],
    },
});
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// REST API Routes
app.use('/api/projects', projects_1.default);
app.use('/api/config', config_1.default);
app.use('/api/sessions', sessions_1.default);
app.use('/api/claude', claude_meta_1.default);
// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', activeSessions: claude_1.claudeService.getActiveSessions().length });
});
// =========================
// Socket.io Event Handling
// =========================
io.on('connection', (socket) => {
    logger_1.logger.info(`[Socket] Client connected: ${socket.id}`);
    // Start a new Claude session (or resume from disk)
    socket.on('session:start', async (data) => {
        try {
            logger_1.logger.info(`[Socket] session:start received: projectId=${data.projectId}, sessionId=${data.sessionId}, effortLevel=${data.effortLevel}`);
            const sessionId = await claude_1.claudeService.startSession(data.projectId, data.sessionId, data.effortLevel);
            // Leave any previous session rooms first
            for (const room of socket.rooms) {
                if (room !== socket.id) {
                    socket.leave(room);
                }
            }
            socket.join(sessionId);
            // Push current state (messages loaded from disk or memory)
            const state = claude_1.claudeService.getSessionState(sessionId);
            logger_1.logger.info(`[Socket] session:started emitting: sessionId=${sessionId}, messages=${state?.messages?.length || 0}`);
            socket.emit('session:started', { sessionId, state });
            // Thông báo toàn cục cho sidebar cập nhật ngay lập tức
            io.emit('global:session_created', { sessionId, projectId: data.projectId });
        }
        catch (err) {
            logger_1.logger.error(`[Socket] session:start error:`, err);
            const error = err instanceof Error ? err.message : String(err);
            socket.emit('chat:error', { sessionId: '', error });
        }
    });
    // Attach to existing session actively
    socket.on('session:attach', (data) => {
        if (claude_1.claudeService.isSessionActive(data.sessionId)) {
            socket.join(data.sessionId);
            const state = claude_1.claudeService.getSessionState(data.sessionId);
            socket.emit('session:started', { sessionId: data.sessionId, state });
        }
        else {
            socket.emit('chat:error', { sessionId: data.sessionId, error: 'Session not found or ended.' });
        }
    });
    // Send a chat message
    socket.on('chat:send', (data) => {
        try {
            claude_1.claudeService.sendMessage(data.sessionId, data.message);
            // Emit user message back to all clients in this session room
            const userMsg = {
                id: `user-${Date.now()}`,
                role: 'user',
                content: data.message,
                timestamp: new Date().toISOString(),
            };
            io.to(data.sessionId).emit('chat:message', {
                sessionId: data.sessionId,
                message: userMsg,
            });
        }
        catch (err) {
            // Log chi tiết lỗi ở server để dễ debug
            logger_1.logger.error(`[chat:send] Error for session ${data.sessionId}:`, err);
            let errorMsg;
            if (err instanceof Error) {
                errorMsg = err.message;
            }
            else if (typeof err === 'string') {
                errorMsg = err;
            }
            else {
                errorMsg = JSON.stringify(err) || 'Lỗi không xác định';
            }
            socket.emit('chat:error', { sessionId: data.sessionId, error: errorMsg });
        }
    });
    // Abort current request
    socket.on('chat:abort', (data) => {
        claude_1.claudeService.abortSession(data.sessionId);
    });
    // Stop session
    socket.on('session:stop', (data) => {
        claude_1.claudeService.stopSession(data.sessionId);
        io.to(data.sessionId).emit('session:ended', { sessionId: data.sessionId });
    });
    // Set effort level for current session
    socket.on('session:setEffort', (data) => {
        try {
            claude_1.claudeService.setSessionEffortLevel(data.sessionId, data.effortLevel);
            io.to(data.sessionId).emit('session:effortChanged', {
                sessionId: data.sessionId,
                effortLevel: data.effortLevel,
            });
        }
        catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error';
            socket.emit('chat:error', { sessionId: data.sessionId, error });
        }
    });
    // Set permission mode for current session
    socket.on('session:setPermissionMode', (data) => {
        try {
            claude_1.claudeService.setSessionPermissionMode(data.sessionId, data.permissionMode);
            io.to(data.sessionId).emit('session:permissionModeChanged', {
                sessionId: data.sessionId,
                permissionMode: data.permissionMode,
            });
        }
        catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error';
            socket.emit('chat:error', { sessionId: data.sessionId, error });
        }
    });
    // Phản hồi permission request từ frontend (allow/deny tool use)
    socket.on('permission:respond', (data) => {
        try {
            claude_1.claudeService.resolvePermission(data.sessionId, data.allowed);
        }
        catch (err) {
            const error = err instanceof Error ? err.message : 'Unknown error';
            socket.emit('chat:error', { sessionId: data.sessionId, error });
        }
    });
    // Compact session — nén context hội thoại
    socket.on('chat:compact', async (data) => {
        try {
            logger_1.logger.info(`[Socket] chat:compact for session ${data.sessionId}`);
            socket.emit('chat:status', { sessionId: data.sessionId, status: 'thinking' });
            const newSessionId = await claude_1.claudeService.compactSession(data.sessionId);
            // Rời room cũ, join room mới
            socket.leave(data.sessionId);
            socket.join(newSessionId);
            // Gửi session mới cho frontend
            const newState = claude_1.claudeService.getSessionState(newSessionId);
            socket.emit('session:compacted', {
                oldSessionId: data.sessionId,
                newSessionId,
                state: newState,
            });
            // Reset status
            socket.emit('chat:status', { sessionId: data.sessionId, status: 'idle' });
        }
        catch (err) {
            logger_1.logger.error(`[chat:compact] Error:`, err);
            const error = err instanceof Error ? err.message : String(err);
            socket.emit('chat:error', { sessionId: data.sessionId, error });
            socket.emit('chat:status', { sessionId: data.sessionId, status: 'idle' });
        }
    });
    socket.on('disconnect', () => {
        logger_1.logger.info(`[Socket] Client disconnected: ${socket.id}`);
    });
});
// =========================
// Claude Service Event Forwarding
// =========================
claude_1.claudeService.on('message', (data) => {
    io.to(data.sessionId).emit('chat:message', data);
});
claude_1.claudeService.on('stream', (data) => {
    io.to(data.sessionId).emit('chat:stream', data);
});
claude_1.claudeService.on('stream:tool', (data) => {
    io.to(data.sessionId).emit('chat:stream:tool', data);
});
claude_1.claudeService.on('stream:partial', (data) => {
    io.to(data.sessionId).emit('chat:stream:partial', data);
});
claude_1.claudeService.on('status', (data) => {
    io.to(data.sessionId).emit('chat:status', data);
    // Gửi trạng thái toàn cục cho mọi client — dùng cho Sidebar
    io.emit('global:session_status', {
        sessionId: data.sessionId,
        status: data.status,
    });
});
claude_1.claudeService.on('error', (data) => {
    io.to(data.sessionId).emit('chat:error', data);
});
claude_1.claudeService.on('result', (data) => {
    io.to(data.sessionId).emit('chat:message', {
        sessionId: data.sessionId,
        message: data.result,
    });
});
claude_1.claudeService.on('session:ended', (data) => {
    io.to(data.sessionId).emit('session:ended', data);
});
// Forward permission request tới frontend
claude_1.claudeService.on('permission:request', (data) => {
    io.to(data.sessionId).emit('permission:request', data);
});
// =========================
// Serve Frontend Static Files
// =========================
const frontendPath = path_1.default.join(__dirname, '../../frontend/dist');
app.use(express_1.default.static(frontendPath));
// SPA Fallback for all non-API routes
app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
        return next();
    }
    res.sendFile(path_1.default.join(frontendPath, 'index.html'));
});
// =========================
// Start Server
// =========================
httpServer.listen(Number(PORT), '0.0.0.0', () => {
    logger_1.logger.info(`\n🚀 Claude Web Backend running on http://localhost:${PORT}`);
    logger_1.logger.info(`📡 WebSocket server ready\n`);
});
// Graceful shutdown
process.on('SIGINT', () => {
    logger_1.logger.info('\nShutting down...');
    claude_1.claudeService.cleanup();
    process.exit(0);
});
process.on('SIGTERM', () => {
    claude_1.claudeService.cleanup();
    process.exit(0);
});
//# sourceMappingURL=index.js.map