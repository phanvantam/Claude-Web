import type { Server } from 'socket.io';
import { claudeService } from '../services/claude';
import { logger } from '../services/logger';

export function registerClaudeEventForwarders(io: Server): void {
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

  claudeService.on('stream:block_start', (data) => {
    io.to(data.sessionId).emit('chat:stream:block_start', data);
  });

  claudeService.on('stream:block_delta', (data) => {
    io.to(data.sessionId).emit('chat:stream:block_delta', data);
  });

  claudeService.on('stream:block_stop', (data) => {
    io.to(data.sessionId).emit('chat:stream:block_stop', data);
  });

  claudeService.on('status', (data) => {
    if (data.status === 'idle' || data.status === 'initializing') {
      logger.info(`[EventForward] chat:status ${data.status} → session ${data.sessionId}`);
    }
    io.to(data.sessionId).emit('chat:status', data);
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

  claudeService.on('permission:request', (data) => {
    io.to(data.sessionId).emit('permission:request', data);
  });

  claudeService.on('subagent:started', (data) => {
    io.to(data.sessionId).emit('subagent:started', data);
  });

  claudeService.on('subagent:ended', (data) => {
    io.to(data.sessionId).emit('subagent:ended', data);
  });

  claudeService.on('subagent:activity', (data) => {
    io.to(data.sessionId).emit('subagent:activity', data);
  });

  claudeService.on('askUser:question', (data) => {
    io.to(data.sessionId).emit('askUser:question', data);
  });

  claudeService.on('task:progress', (data) => {
    io.to(data.sessionId).emit('task:progress', data);
  });

  claudeService.on('mcp:status', (data) => {
    io.to(data.sessionId).emit('mcp:status', data);
  });

  claudeService.on('mcp:resolved', (data) => {
    io.to(data.sessionId).emit('mcp:resolved', data);
  });

  claudeService.on('prompt:suggestion', (data) => {
    io.to(data.sessionId).emit('prompt:suggestion', data);
  });
}
