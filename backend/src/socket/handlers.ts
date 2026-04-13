import type { Server, Socket } from 'socket.io';
import { claudeService } from '../services/claude';
import { getMcpServersDetailed } from '../services/claude-meta';
import { getSession } from '../services/session';
import { getProject } from '../services/project';
import { logger } from '../services/logger';

export function registerSocketHandlers(io: Server, socket: Socket): void {
  logger.info(`[Socket] Client connected: ${socket.id}`);

  socket.on('session:start', async (data: { projectId: string; sessionId?: string; effortLevel?: string }) => {
    try {
      logger.info(`[Socket] session:start received: projectId=${data.projectId}, sessionId=${data.sessionId}, effortLevel=${data.effortLevel}`);
      const sessionId = await claudeService.startSession(data.projectId, data.sessionId, data.effortLevel);

      socket.join(sessionId);
      for (const room of socket.rooms) {
        if (room !== socket.id && room !== sessionId) {
          socket.leave(room);
        }
      }

      const state = claudeService.getSessionState(sessionId);
      logger.info(`[Socket] session:started emitting: sessionId=${sessionId}, messages=${state?.messages?.length || 0}, isProcessing=${state?.isProcessing}, activeToolName=${state?.activeToolName}, activeSubAgent=${state?.activeSubAgent?.name}`);
      socket.emit('session:started', { sessionId, state });

      io.emit('global:session_created', { sessionId, projectId: data.projectId });
    } catch (err: unknown) {
      logger.error(`[Socket] session:start error:`, err);
      const error = err instanceof Error ? err.message : String(err);
      socket.emit('chat:error', { sessionId: '', error });
    }
  });

  socket.on('session:attach', (data: { sessionId: string }) => {
    if (claudeService.isSessionActive(data.sessionId)) {
      socket.join(data.sessionId);
      const state = claudeService.getSessionState(data.sessionId);
      socket.emit('session:started', { sessionId: data.sessionId, state });
      if (state?.isProcessing) {
        socket.emit('chat:status', {
          sessionId: data.sessionId,
          status: state.pendingPermission ? 'tool_use' : (state.activeToolName ? 'tool_use' : 'thinking'),
          toolName: state.activeToolName,
          startedAt: state.processingStartedAt,
        });
      }
    } else {
      socket.emit('chat:error', { sessionId: data.sessionId, error: 'Session not found or ended.' });
    }
  });

  socket.on('chat:send', (data: { sessionId: string; message: string; displayText?: string }) => {
    try {
      claudeService.sendMessage(data.sessionId, data.message);

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

  socket.on('chat:abort', (data: { sessionId: string }) => {
    claudeService.abortSession(data.sessionId);
  });

  socket.on('session:stop', (data: { sessionId: string }) => {
    claudeService.stopSession(data.sessionId);
    io.to(data.sessionId).emit('session:ended', { sessionId: data.sessionId });
  });

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

  socket.on('permission:respond', (data: { sessionId: string; allowed: boolean }) => {
    try {
      claudeService.resolvePermission(data.sessionId, data.allowed);
      io.to(data.sessionId).emit('permission:resolved', {
        sessionId: data.sessionId,
        allowed: data.allowed,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      socket.emit('chat:error', { sessionId: data.sessionId, error });
    }
  });

  socket.on('askUser:respond', (data: { sessionId: string; answer: string }) => {
    try {
      claudeService.resolveAskUser(data.sessionId, data.answer);
      io.to(data.sessionId).emit('askUser:resolved', {
        sessionId: data.sessionId,
        answer: data.answer,
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : 'Unknown error';
      socket.emit('chat:error', { sessionId: data.sessionId, error });
    }
  });

  socket.on('chat:compact', async (data: { sessionId: string }) => {
    try {
      logger.info(`[Socket] chat:compact for session ${data.sessionId}`);
      socket.emit('chat:status', { sessionId: data.sessionId, status: 'thinking' });

      const newSessionId = await claudeService.compactSession(data.sessionId);

      socket.leave(data.sessionId);
      socket.join(newSessionId);

      const newState = claudeService.getSessionState(newSessionId);
      socket.emit('session:compacted', {
        oldSessionId: data.sessionId,
        newSessionId,
        state: newState,
      });

      socket.emit('chat:status', { sessionId: data.sessionId, status: 'idle' });
    } catch (err: unknown) {
      logger.error(`[chat:compact] Error:`, err);
      const error = err instanceof Error ? err.message : String(err);
      socket.emit('chat:error', { sessionId: data.sessionId, error });
      socket.emit('chat:status', { sessionId: data.sessionId, status: 'idle' });
    }
  });

  socket.on('mcp:refresh', (data: { sessionId: string }) => {
    logger.info(`[Socket] MCP refresh requested for session ${data.sessionId}`);
    try {
      const session = getSession(data.sessionId);
      const project = session?.projectId ? getProject(session.projectId) : null;
      const cwd = project?.path || process.cwd();

      const mcpData = getMcpServersDetailed(cwd);
      const mergedMcp = { ...mcpData.global, ...mcpData.project };
      const servers = Object.keys(mergedMcp).map(name => ({
        name,
        status: 'connected' as const,
        serverInfo: null,
        tools: [] as string[],
        error: null,
      }));
      socket.emit('mcp:status', { sessionId: data.sessionId, servers });
      logger.info(`[Socket] MCP refresh done: ${servers.length} servers`);
    } catch (err) {
      logger.warn(`[Socket] MCP refresh failed:`, err);
    }
  });

  socket.on('disconnect', () => {
    logger.info(`[Socket] Client disconnected: ${socket.id}`);
  });
}
