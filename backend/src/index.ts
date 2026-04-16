import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import projectRoutes from './routes/projects';
import configRoutes from './routes/config';
import sessionRoutes from './routes/sessions';
import claudeMetaRoutes from './routes/claude-meta';
import planRoutes from './routes/plan';
import { claudeService } from './services/claude';
import { logger } from './services/logger';
import { registerSocketHandlers } from './socket/handlers';
import { registerClaudeEventForwarders } from './socket/eventForwarders';

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
app.use('/api/plan', planRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', activeSessions: claudeService.getActiveSessions().length });
});

/**
 * DEBUG: Test SDK query trực tiếp — không qua session/socket.
 * Mục đích duy nhất: xác nhận SDK có emit event 'result' hay không.
 * GET /api/debug/sdk-test?cwd=/path/to/project
 * GET /api/debug/sdk-test?cwd=/path&noMcp=1  ← tắt MCP servers để so sánh
 * Timeout 60s — nếu không nhận result trong 60s → trả lỗi.
 */
app.get('/api/debug/sdk-test', async (_req, res) => {
  const cwd = (_req.query.cwd as string) || process.cwd();
  const noMcp = _req.query.noMcp === '1';
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

    const sdkOptions: Record<string, any> = {
      cwd,
      env: cleanEnv,
      permissionMode: 'acceptEdits',
      systemPrompt: 'Bạn là bot test. Trả lời ngắn nhất có thể.',
    };

    // noMcp=1: ép CLI không load MCP servers từ user config
    // Nếu kết quả nhanh hơn đáng kể → MCP daemon giữ CLI alive là root cause
    if (noMcp) {
      sdkOptions.mcpServers = {};
      sdkOptions.settingSources = [];
    }

    const queryInstance = sdk.query({
      prompt,
      options: sdkOptions,
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
  registerSocketHandlers(io, socket);
});

// =========================
// Claude Service Event Forwarding
// =========================
registerClaudeEventForwarders(io);

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
  logger.info(`\nClaude Web Backend running on http://localhost:${PORT}`);
  logger.info(`WebSocket server ready\n`);
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
  // Khi chủ động interrupt stream, SDK có thể ném ede_diagnostic + Request was aborted.
  // Đây là kết quả expected của luồng dừng, không phải crash thực sự.
  const errMessage = String(err?.message || err || '');
  if (errMessage.includes('Claude Code returned an error result: [ede_diagnostic]') && (errMessage.includes('Request was aborted') || errMessage.includes('stop_reason=tool_use'))) {
    logger.warn('[Process] SDK ede_diagnostic after interrupt/tool-use abort — expected, ignoring...');
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
