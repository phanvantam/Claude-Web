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

// Disable ETag globally to prevent caching based on content hash
app.set('etag', false);

// Production: frontend được serve từ cùng origin (nginx proxy) → không cần whitelist.
// Dev: cần whitelist localhost ports.
const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
const io = new Server(httpServer, {
  cors: {
    origin: isDev ? ['http://localhost:5173', 'http://localhost:3000'] : true,
    methods: ['GET', 'POST'],
  },
  // Ưu tiên WebSocket trước — tránh polling overhead qua nginx
  transports: ['websocket', 'polling'],
  // Tăng ping timeout để tránh false disconnect khi nginx proxy chậm
  pingTimeout: 30000,
  pingInterval: 15000,
});

// Middleware
app.use(cors());
app.use(express.json());

// Disable caching for API routes
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// REST API Routes
app.use('/api/projects', projectRoutes);
app.use('/api/config', configRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/claude', claudeMetaRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeSessions: claudeService.getActiveSessions().length });
});

/**
 * DEBUG: Test SDK query trực tiếp — không qua session/socket.
 * Mục đích duy nhất: xác nhận SDK có emit event 'result' hay không.
 * GET /api/debug/sdk-test?cwd=/path/to/project
 * Timeout 60s — nếu không nhận result trong 60s → trả lỗi.
 */
app.get('/api/debug/sdk-test', async (_req, res) => {
  const cwd = (_req.query.cwd as string) || process.cwd();
  const prompt = 'Trả lời đúng 1 từ: "ok"';
  const startMs = Date.now();
  const events: { type: string; elapsed: number; detail?: string }[] = [];
  let gotResult = false;

  try {
    const sdk = await (await import('./services/claude/utils')).getSDK();

    // Env sạch — loại bỏ biến PM2/parent có thể gây nested session
    const cleanEnv: Record<string, string | undefined> = {
      ...process.env,
      CLAUDECODE: undefined,
      CLAUDE_CODE_ENTRYPOINT: undefined,
    };

    const queryInstance = sdk.query({
      prompt,
      options: {
        cwd,
        env: cleanEnv,
        permissionMode: 'acceptEdits',
        systemPrompt: 'Bạn là bot test. Trả lời ngắn nhất có thể.',
      },
    });

    // Timeout 60s — ép dừng nếu SDK treo
    // interrupt() nội bộ gọi transport.write() async → phải await
    const timeout = setTimeout(async () => {
      try { await queryInstance.interrupt(); } catch {}
    }, 60_000);

    for await (const msg of queryInstance) {
      const elapsed = Date.now() - startMs;
      const type = msg.type as string;

      events.push({
        type,
        elapsed,
        detail: type === 'result'
          ? `is_error=${(msg as any).is_error}, cost=$${(msg as any).total_cost_usd || 0}`
          : type === 'assistant'
            ? `blocks=${(msg as any).message?.content?.length || 0}`
            : undefined,
      });

      logger.info(`[SDK-TEST] [T+${elapsed}ms] Event: ${type}`);

      if (type === 'result') {
        gotResult = true;
        clearTimeout(timeout);
        // Interrupt sau result để cleanup
        try { await queryInstance.interrupt(); } catch {}
      }
    }

    clearTimeout(timeout);

    res.json({
      success: true,
      gotResult,
      totalMs: Date.now() - startMs,
      eventCount: events.length,
      events,
      env: {
        CLAUDECODE: process.env.CLAUDECODE || '(not set)',
        CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT || '(not set)',
        NODE_ENV: process.env.NODE_ENV || '(not set)',
      },
    });
  } catch (err: any) {
    res.json({
      success: false,
      gotResult,
      totalMs: Date.now() - startMs,
      error: err.message || String(err),
      eventCount: events.length,
      events,
      env: {
        CLAUDECODE: process.env.CLAUDECODE || '(not set)',
        CLAUDE_CODE_ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT || '(not set)',
        NODE_ENV: process.env.NODE_ENV || '(not set)',
      },
    });
  }
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

      // Join room mới TRƯỚC — tránh khoảng hở miss event.
      // Nếu leave trước rồi join sau: trong ~1 tick, socket không ở room nào
      // → bỏ lỡ chat:message + chat:status idle emitted đúng lúc đó.
      socket.join(sessionId);
      // Leave các room cũ khác (không phải socket.id và không phải room mới)
      for (const room of socket.rooms) {
        if (room !== socket.id && room !== sessionId) {
          socket.leave(room);
        }
      }

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
  // displayText: text hiển thị cho user (optional) — khác message gửi cho Claude khi @mention transform
  socket.on('chat:send', (data: { sessionId: string; message: string; displayText?: string }) => {
    try {
      claudeService.sendMessage(data.sessionId, data.message);

      // Emit user message back to all clients in this session room
      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        content: data.displayText || data.message,
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

  // Phản hồi AskUserQuestion từ frontend (user trả lời câu hỏi)
  socket.on('askUser:respond', (data: { sessionId: string; answer: string }) => {
    try {
      claudeService.resolveAskUser(data.sessionId, data.answer);
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
  // Log chi tiết khi chuyển status — quan trọng cho debug production
  if (data.status === 'idle' || data.status === 'initializing') {
    logger.info(`[EventForward] chat:status ${data.status} → session ${data.sessionId}`);
  }
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

// Forward sub-agent started event — frontend hiện indicator trong timeline
claudeService.on('subagent:started', (data) => {
  io.to(data.sessionId).emit('subagent:started', data);
});

// Forward sub-agent ended event — frontend clear indicator + hiện result
claudeService.on('subagent:ended', (data) => {
  io.to(data.sessionId).emit('subagent:ended', data);
});

// Forward AskUserQuestion event — frontend hiện box hỏi đáp tương tác
claudeService.on('askUser:question', (data) => {
  io.to(data.sessionId).emit('askUser:question', data);
});

// =========================
// Serve Frontend Static Files
// =========================
const frontendPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendPath));

// SPA Fallback for all non-API routes
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
    logger.warn(`[Server] API route not found: ${req.method} ${req.path}`);
    return next();
  }
  // Disable caching for index.html
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// =========================
// Start Server
// =========================
httpServer.listen(Number(PORT), '0.0.0.0', () => {
  logger.info(`\n🚀 Claude Web Backend running on http://localhost:${PORT}`);
  logger.info(`📡 WebSocket server ready\n`);
});

// Graceful shutdown & Error handling
process.on('uncaughtException', (err: any) => {
  if (err.code === 'EPIPE') {
    // EPIPE (Broken Pipe) thường xảy ra khi Claude CLI process bị đóng đột ngột
    // hoặc socket bị ngắt kết nối trong khi đang ghi data. Có thể bỏ qua an toàn.
    logger.warn('[Process] EPIPE error caught (Broken Pipe), ignoring...');
    return;
  }
  // claude-agent-sdk throw 'Query closed before response received' sau interrupt()
  // Đây là side effect bình thường khi ép SDK dừng — bỏ qua an toàn.
  if (err?.message?.includes('Query closed before response received')) {
    logger.warn('[Process] SDK Query closed after interrupt — expected, ignoring...');
    return;
  }
  // interrupt() gọi transport.write() khi process đã đóng → async throw
  // Side effect bình thường — không ảnh hưởng logic.
  if (err?.message?.includes('ProcessTransport is not ready for writing')) {
    logger.warn('[Process] ProcessTransport not ready (interrupt after close) — ignoring...');
    return;
  }
  logger.error('[Process] Uncaught Exception:', err);
});

process.on('SIGINT', () => {
  logger.info('\nShutting down...');
  claudeService.cleanup();
  process.exit(0);
});

process.on('SIGTERM', () => {
  claudeService.cleanup();
  process.exit(0);
});
