/**
 * Runtime control: watchdog timer + Linux completion token interrupt.
 *
 * Tách ra từ sdkRunner.ts — phần này tự quản lý timer lifecycle và có thể
 * được khởi tạo độc lập rồi wired vào orchestration chính.
 *
 * Các bộ đếm/threshold:
 * - STREAM_IDLE_TIMEOUT_MS: model im lặng > 5 phút → treo, cắt.
 * - TOOL_EXEC_TIMEOUT_MS: tool chạy > 10 phút → hợp lệ, vẫn chờ.
 * - LINUX_COMPLETION_INTERRUPT_DELAY_MS: chờ 2s sau token trước khi interrupt.
 */

import { ClaudeSessionState } from '../types';
import { logger } from '../../logger';

export const STREAM_IDLE_TIMEOUT_MS = 300_000;    // 5 phút — model im lặng
export const TOOL_EXEC_TIMEOUT_MS = 600_000;      // 10 phút — tool chạy dài
export const LINUX_COMPLETION_INTERRUPT_DELAY_MS = 2000;

export interface WatchdogConfig {
  sessionId: string;
  state: ClaudeSessionState;
  onTimeout: (reason: string) => void;
}

export interface WatchdogController {
  reset: () => void;
  clear: () => void;
  getTimeout: () => number;
}

export interface TokenController {
  checkText: (text: string) => boolean;
  checkStreamChunk: (chunk: string) => boolean;
  scheduleInterrupt: (source: 'stream_event' | 'assistant', onDetected?: () => void) => void;
  clear: () => void;
}

/** Tạo watchdog controller — quản lý safety timer thích ứng theo context. */
export function createWatchdogController(cfg: WatchdogConfig): WatchdogController {
  const { sessionId, state, onTimeout } = cfg;
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let lastActiveToolName: string | null = null;

  const getTimeout = (): number => {
    const isToolRunning = !!state.activeToolName;
    const isSubAgentRunning = !!state.activeSubAgent;
    const isPendingPermission = !!state.pendingPermission;

    if (isPendingPermission || isToolRunning || isSubAgentRunning) {
      return TOOL_EXEC_TIMEOUT_MS;
    }
    return STREAM_IDLE_TIMEOUT_MS;
  };

  const reset = () => {
    if (safetyTimer) clearTimeout(safetyTimer);
    lastActiveToolName = state.activeToolName || null;

    const timeoutMs = getTimeout();

    safetyTimer = setTimeout(async () => {
      // Thời điểm timer fire, check lại trạng thái — có thể đã thay đổi
      if (state.pendingPermission) {
        logger.debug(`[Claude][${sessionId}] Watchdog skipped — pending permission`);
        reset();
        return;
      }

      const reason = state.activeToolName
        ? `Tool '${state.activeToolName}' chạy quá ${TOOL_EXEC_TIMEOUT_MS / 1000}s`
        : `Không nhận được dữ liệu sau ${STREAM_IDLE_TIMEOUT_MS / 1000}s (SSE Stall?)`;

      logger.warn(`[Claude][${sessionId}] Dynamic Watchdog triggered: ${reason}`);
      state.interruptReason = 'watchdog_timeout';

      onTimeout(reason);
    }, timeoutMs);
  };

  const clear = () => {
    if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
  };

  return { reset, clear, getTimeout };
}

/** Tạo token controller — theo dõi Linux completion token trong text/stream. */
export function createTokenController(
  sessionId: string,
  state: ClaudeSessionState,
  onTokenDetected: (source: 'stream_event' | 'assistant') => void,
  enableToken: boolean,
): TokenController {
  const normalizedToken = '__CLAUDE_SESSION_END__'.toUpperCase();
  let streamCompletionTokenTail = '';

  const checkText = (text: string): boolean => {
    if (!enableToken) return false;
    return text.toUpperCase().includes(normalizedToken);
  };

  const checkStreamChunk = (chunk: string): boolean => {
    if (!enableToken || !chunk) return false;
    const merged = `${streamCompletionTokenTail}${chunk}`.toUpperCase();
    const found = merged.includes(normalizedToken);
    const tailLength = Math.max(normalizedToken.length - 1, 0);
    streamCompletionTokenTail = tailLength > 0 ? merged.slice(-tailLength) : '';
    return found;
  };

  let interruptTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleInterrupt = (source: 'stream_event' | 'assistant', onDetected?: () => void) => {
    if (state.linuxCompletionTokenDetected) return;
    state.linuxCompletionTokenDetected = true;
    state.interruptReason = 'linux_completion_token';

    if (interruptTimer) clearTimeout(interruptTimer);

    logger.info(
      `[Claude][${sessionId}] Linux completion token detected from ${source}, schedule interrupt in ${LINUX_COMPLETION_INTERRUPT_DELAY_MS}ms`,
    );

    if (onDetected) onDetected();
    onTokenDetected(source);

    interruptTimer = setTimeout(async () => {
      const queryInstance = state.queryInstance;
      if (!queryInstance || !state.isProcessing) {
        interruptTimer = null;
        return;
      }

      logger.info(`[Claude][${sessionId}] Linux completion delay elapsed, interrupting query`);
      try {
        await queryInstance.interrupt();
      } catch (err: any) {
        if (err?.message?.includes('Query closed') || err?.message?.includes('ProcessTransport')) {
          logger.debug(`[Claude][${sessionId}] interrupt() after Linux completion token returned expected close error`);
        } else {
          logger.warn(`[Claude][${sessionId}] interrupt() after Linux completion token failed:`, err);
        }
      } finally {
        interruptTimer = null;
      }
    }, LINUX_COMPLETION_INTERRUPT_DELAY_MS);
  };

  const clear = () => {
    if (interruptTimer) { clearTimeout(interruptTimer); interruptTimer = null; }
    streamCompletionTokenTail = '';
  };

  return { checkText, checkStreamChunk, scheduleInterrupt, clear };
}

/** Kiểm tra abort state — used trong canUseTool và event loop. */
export function isAbortRequested(state: ClaudeSessionState): boolean {
  return !!state.abortRequestedAt || state.interruptReason === 'user_abort';
}

/** Kiểm tra event có nên bị bỏ qua sau interrupt. */
export function shouldIgnoreEventAfterInterrupt(state: ClaudeSessionState, eventType: string): boolean {
  if (!state.isProcessing) return false;

  if (state.interruptReason === 'user_abort' || !!state.abortRequestedAt) {
    return eventType !== 'result';
  }

  // Linux completion token: KHÔNG bỏ qua event nào.
  if (state.interruptReason === 'linux_completion_token') {
    return false;
  }

  return false;
}
