/**
 * Hook đăng ký toàn bộ socket.io event listeners cho chat system.
 *
 * File gốc (~542 dòng) đã được tách thành:
 *   - socketListeners/types.ts          — shared types
 *   - socketListeners/streamHandlers.ts  — chat:stream*, block events
 *   - socketListeners/sessionHandlers.ts — session lifecycle, permission, subagent, mcp
 *
 * File này chỉ còn orchestration: connect → register → cleanup.
 */

import { useEffect } from 'react';
import { socketService } from '../services/socket';
import { registerStreamHandlers } from './socketListeners/streamHandlers';
import { registerSessionHandlers } from './socketListeners/sessionHandlers';
import type { SocketHandlerDeps } from './socketListeners/types';

// Re-export types để useChat.ts không cần thay đổi import paths
export type { ChatStatus, ActiveSubAgent, SessionStartedState, SocketHandlerDeps } from './socketListeners/types';

export function useChatSocketListeners(deps: SocketHandlerDeps): void {
  useEffect(() => {
    const socket = socketService.connect();

    // ─── Connect/Disconnect ─────────────────────────────────────────
    socket.on('connect', () => {
      deps.setIsConnected(true);
      const sid = deps.sessionIdRef.current;
      if (sid) {
        socket.emit('session:attach', { sessionId: sid });
      }
    });

    socket.on('disconnect', () => {
      deps.setIsConnected(false);
    });

    // ─── Đăng ký handlers theo nhóm ─────────────────────────────────
    const streamEvents = registerStreamHandlers(socket, deps);
    const sessionEvents = registerSessionHandlers(socket, deps);

    // ─── Cleanup ────────────────────────────────────────────────────
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      for (const event of [...streamEvents, ...sessionEvents]) {
        socket.off(event);
      }
      socketService.release();
    };
  }, []);
}
