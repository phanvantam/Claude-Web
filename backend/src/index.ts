import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import projectRoutes from './routes/projects';
import configRoutes from './routes/config';
import sessionRoutes from './routes/sessions';
import claudeMetaRoutes from './routes/claude-meta';
import { claudeService } from './services/claude';
import { logger } from './services/logger';

const PORT = process.env.PORT || 3001;
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// REST API Routes
app.use('/api/projects', projectRoutes);
app.use('/api/config', configRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/claude', claudeMetaRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeSessions: claudeService.getActiveSessions().length });
});

// =========================
// Socket.io Event Handling
// =========================
io.on('connection', (socket) => {
  logger.info(`[Socket] Client connected: ${socket.id}`);

  // Start a new Claude session (or resume from disk)
  socket.on('session:start', async (data: { projectId: string; sessionId?: string; effortLevel?: string }) => {
    try {
      logger.info(`[Socket] session:start received: projectId=${data.projectId}, sessionId=${data.sessionId}, effortLevel=${data.effortLevel}`);
      const sessionId = await claudeService.startSession(data.projectId, data.sessionId, data.effortLevel);

      // Leave any previous session rooms first
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.leave(room);
        }
      }
      socket.join(sessionId);
      
      // Push current state (messages loaded from disk or memory)
      const state = claudeService.getSessionState(sessionId);
      logger.info(`[Socket] session:started emitting: sessionId=${sessionId}, messages=${state?.messages?.length || 0}`);
      socket.emit('session:started', { sessionId, state });

      // Thông báo toàn cục cho sidebar cập nhật ngay lập tức
      io.emit('global:session_created', { sessionId, projectId: data.projectId });
    } catch (err: unknown) {
      logger.error(`[Socket] session:start error:`, err);
      const error = err instanceof Error ? err.message : String(err);
      socket.emit('chat:error', { sessionId: '', error });
    }
  });

  // Attach to existing session actively
  socket.on('session:attach', (data: { sessionId: string }) => {
    if (claudeService.isSessionActive(data.sessionId)) {
      socket.join(data.sessionId);
      const state = claudeService.getSessionState(data.sessionId);
      socket.emit('session:started', { sessionId: data.sessionId, state });
    } else {
      socket.emit('chat:error', { sessionId: data.sessionId, error: 'Session not found or ended.' });
    }
  });

  // Send a chat message
  socket.on('chat:send', (data: { sessionId: string; message: string }) => {
    try {
      claudeService.sendMessage(data.sessionId, data.message);

      // Emit user message back to all clients in this session room
      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        content: data.message,
        timestamp: new Date().toISOString(),
      };
      io.to(data.sessionId).emit('chat:message', {
        sessionId: data.sessionId,
        message: userMsg,
      });
    } catch (err: unknown) {
      // Log chi tiết lỗi ở server để dễ debug
      logger.error(`[chat:send] Error for session ${data.sessionId}:`, err);
      let errorMsg: string;
      if (err instanceof Error) {
        errorMsg = err.message;
      } else if (typeof err === 'string') {
        errorMsg = err;
      } else {
        errorMsg = JSON.stringify(err) || 'Lỗi không xác định';
      }
      socket.emit('chat:error', { sessionId: data.sessionId, error: errorMsg });
    }
  });

  // Abort current request
  socket.on('chat:abort', (data: { sessionId: string }) => {
    claudeService.abortSession(data.sessionId);
  });

  // Stop session
  socket.on('session:stop', (data: { sessionId: string }) => {
    claudeService.stopSession(data.sessionId);
    io.to(data.sessionId).emit('session:ended', { sessionId: data.sessionId });
  });

  // Set effort level for current session
  socket.on('session:setEffort', (data: { sessionId: string; effortLevel?: string }) => {
    try {
      claudeService.setSessionEffortLevel(data.sessionId, data.effortLevel);
      io.to(data.sessionId).emit('session:effortChanged', {
        sessionId: data.sessionId,
        effortLevel: data.effortLevel,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      socket.emit('chat:error', { sessionId: data.sessionId, error });
    }
  });

  // Set permission mode for current session
  socket.on('session:setPermissionMode', (data: { sessionId: string; permissionMode?: string }) => {
    try {
      claudeService.setSessionPermissionMode(data.sessionId, data.permissionMode);
      io.to(data.sessionId).emit('session:permissionModeChanged', {
        sessionId: data.sessionId,
        permissionMode: data.permissionMode,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      socket.emit('chat:error', { sessionId: data.sessionId, error });
    }
  });

  // Phản hồi permission request từ frontend (allow/deny tool use)
  socket.on('permission:respond', (data: { sessionId: string; allowed: boolean }) => {
    try {
      claudeService.resolvePermission(data.sessionId, data.allowed);
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      socket.emit('chat:error', { sessionId: data.sessionId, error });
    }
  });

  // Compact session — nén context hội thoại
  socket.on('chat:compact', async (data: { sessionId: string }) => {
    try {
      logger.info(`[Socket] chat:compact for session ${data.sessionId}`);
      socket.emit('chat:status', { sessionId: data.sessionId, status: 'thinking' });

      const newSessionId = await claudeService.compactSession(data.sessionId);

      // Rời room cũ, join room mới
      socket.leave(data.sessionId);
      socket.join(newSessionId);

      // Gửi session mới cho frontend
      const newState = claudeService.getSessionState(newSessionId);
      socket.emit('session:compacted', {
        oldSessionId: data.sessionId,
        newSessionId,
        state: newState,
      });

      // Reset status
      socket.emit('chat:status', { sessionId: data.sessionId, status: 'idle' });
    } catch (err: unknown) {
      logger.error(`[chat:compact] Error:`, err);
      const error = err instanceof Error ? err.message : String(err);
      socket.emit('chat:error', { sessionId: data.sessionId, error });
      socket.emit('chat:status', { sessionId: data.sessionId, status: 'idle' });
    }
  });

  socket.on('disconnect', () => {
    logger.info(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// =========================
// Claude Service Event Forwarding
// =========================
claudeService.on('message', (data) => {
  io.to(data.sessionId).emit('chat:message', data);
});

claudeService.on('stream', (data) => {
  io.to(data.sessionId).emit('chat:stream', data);
});

claudeService.on('stream:tool', (data) => {
  io.to(data.sessionId).emit('chat:stream:tool', data);
});

claudeService.on('stream:partial', (data) => {
  io.to(data.sessionId).emit('chat:stream:partial', data);
});

claudeService.on('status', (data) => {
  io.to(data.sessionId).emit('chat:status', data);
  // Gửi trạng thái toàn cục cho mọi client — dùng cho Sidebar
  io.emit('global:session_status', {
    sessionId: data.sessionId,
    status: data.status,
  });
});

claudeService.on('error', (data) => {
  io.to(data.sessionId).emit('chat:error', data);
});

claudeService.on('result', (data) => {
  io.to(data.sessionId).emit('chat:message', {
    sessionId: data.sessionId,
    message: data.result,
  });
});

claudeService.on('session:ended', (data) => {
  io.to(data.sessionId).emit('session:ended', data);
});

// Forward permission request tới frontend
claudeService.on('permission:request', (data) => {
  io.to(data.sessionId).emit('permission:request', data);
});

// =========================
// Serve Frontend Static Files
// =========================
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// SPA Fallback for all non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    return next();
  }
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// =========================
// Start Server
// =========================
httpServer.listen(Number(PORT), '0.0.0.0', () => {
  logger.info(`\n🚀 Claude Web Backend running on http://localhost:${PORT}`);
  logger.info(`📡 WebSocket server ready\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('\nShutting down...');
  claudeService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  claudeService.cleanup();
  process.exit(0);
});
