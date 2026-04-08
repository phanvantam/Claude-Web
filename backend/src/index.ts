import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import projectRoutes from './routes/projects';
import configRoutes from './routes/config';
import sessionRoutes from './routes/sessions';
import { claudeService } from './services/claude';

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

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeSessions: claudeService.getActiveSessions().length });
});

// =========================
// Socket.io Event Handling
// =========================
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Start a new Claude session (or resume from disk)
  socket.on('session:start', async (data: { projectId: string; sessionId?: string }) => {
    try {
      console.log(`[Socket] session:start received: projectId=${data.projectId}, sessionId=${data.sessionId}`);
      const sessionId = await claudeService.startSession(data.projectId, data.sessionId);

      // Leave any previous session rooms first
      for (const room of socket.rooms) {
        if (room !== socket.id) {
          socket.leave(room);
        }
      }
      socket.join(sessionId);
      
      // Push current state (messages loaded from disk or memory)
      const state = claudeService.getSessionState(sessionId);
      console.log(`[Socket] session:started emitting: sessionId=${sessionId}, messages=${state?.messages?.length || 0}`);
      socket.emit('session:started', { sessionId, state });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[Socket] session:start error:`, error);
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
      const error = err instanceof Error ? err.message : 'Unknown error';
      socket.emit('chat:error', { sessionId: data.sessionId, error });
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

  socket.on('disconnect', () => {
    console.log(`[Socket] Client disconnected: ${socket.id}`);
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
  console.log(`\n🚀 Claude Web Backend running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket server ready\n`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  claudeService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  claudeService.cleanup();
  process.exit(0);
});
