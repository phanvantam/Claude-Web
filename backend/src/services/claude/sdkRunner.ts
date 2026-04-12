import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { ChatMessage, ToolCall, ContentBlock, SubAgentActivity } from '../../types';
import { updateSession } from '../session';
import { getMcpServersDetailed } from '../claude-meta';
import { logger } from '../logger';
import { ClaudeSessionState, SDKQueryConfig } from './types';
import * as utils from './utils';
import { QueryProcessor } from './processor';
import { persistMessage, finalizeAssistantMessage } from './messageHelpers';

/**
 * Chạy SDK query() và xử lý stream messages.
 * Đây là core loop — xử lý system/assistant/user/result events từ SDK.
 *
 * Tách ra khỏi ClaudeService class để giảm kích thước file chính.
 * Nhận state + emitter qua param thay vì this binding.
 */
export async function runSDKQuery(
  sessionId: string,
  message: string,
  config: SDKQueryConfig,
  state: ClaudeSessionState,
  emitter: EventEmitter,
): Promise<void> {
  const sdk = await utils.getSDK();

  // Quyết định resume hay session mới dựa trên file .jsonl thực tế trong Claude CLI storage.
  // App DB (database.sqlite) và CLI storage (~/.claude/projects/) là 2 hệ thống tách biệt.
  const isResume = utils.hasCliSession(sessionId, config.cwd);
  logger.info(`[Claude] Session ${sessionId}: cliSessionExists=${isResume}, strategy=${isResume ? 'resume' : 'new'}`);

  // claude-agent-sdk dùng interrupt() thay vì AbortController
  // Giữ abortController cho internal state tracking (pendingPermission abort listener)
  const abortController = new AbortController();
  state.abortController = abortController;

  // ── Build SDK options (claude-agent-sdk format) ──
  const options: Record<string, any> = {
    cwd: config.cwd,
    // systemPrompt preset: bắt buộc để load CLAUDE.md
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // Load settings từ project, user (~/.config/claude/), local
    settingSources: ['project', 'user', 'local'],
  };

  // Truyền MCP servers vào SDK — merge global + project
  try {
    const mcpData = getMcpServersDetailed(config.cwd);
    const mergedMcp = { ...mcpData.global, ...mcpData.project };
    if (Object.keys(mergedMcp).length > 0) {
      options.mcpServers = mergedMcp;
      logger.info(`[Claude][${sessionId}] MCP servers: ${Object.keys(mergedMcp).join(', ')}`);
    }
  } catch (err) {
    logger.warn(`[Claude][${sessionId}] Failed to load MCP servers:`, err);
  }

  if (isResume) options.resume = sessionId;
  if (config.model) options.model = config.model;

  // ── Permission mode ──
  // canUseTool LUÔN được set để intercept AskUserQuestion (cần UI tương tác bất kể mode).
  // Các tool khác: mode 'default' → hỏi user, mode khác → auto allow.
  const isDefaultMode = !config.permissionMode || config.permissionMode === 'default';
  options.permissionMode = config.permissionMode || 'default';

  options.canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    { signal }: { signal: AbortSignal },
  ) => {
    logger.info(`[Claude][${sessionId}] canUseTool called for: ${toolName}`);
    emitter.emit('status', { sessionId, status: 'tool_use', toolName });

    // AskUserQuestion — LUÔN chờ user trả lời, bất kể permission mode
    if (toolName === 'AskUserQuestion') {
      logger.info(`[Claude][${sessionId}] AskUserQuestion detected, emitting askUser:question`);
      return new Promise<any>((resolve) => {
        if (signal.aborted) {
          return resolve({ behavior: 'deny', message: 'Đã hủy.' });
        }

        state.pendingPermission = { toolName, input, resolve };
        emitter.emit('askUser:question', { sessionId, input });

        const onAbort = () => {
          if (state.pendingPermission?.resolve === resolve) {
            state.pendingPermission = undefined;
            resolve({ behavior: 'deny', message: 'Đã hủy bởi người dùng.' });
          }
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
    }

    // Mode không phải 'default' → auto allow cho các tool thông thường
    if (!isDefaultMode) {
      return { behavior: 'allow' as const, updatedInput: input };
    }

    // Mode 'default' → hỏi user xác nhận qua WebSocket
    return new Promise<any>((resolve) => {
      if (signal.aborted) {
        return resolve({ behavior: 'deny', message: 'Đã hủy.' });
      }

      state.pendingPermission = { toolName, input, resolve };
      emitter.emit('permission:request', { sessionId, toolName, input });

      const onAbort = () => {
        if (state.pendingPermission?.resolve === resolve) {
          state.pendingPermission = undefined;
          resolve({ behavior: 'deny', message: 'Đã hủy bởi người dùng.' });
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  };

  // ── SDK-level options (thay cho extraArgs CLI) ──
  if (config.effortLevel) options.effort = config.effortLevel;
  if (config.systemPrompt) options.systemPrompt = config.systemPrompt;

  // claude-agent-sdk: set stream-close timeout qua env (SDK vẫn đọc env var này)
  const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
  process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

  // Periodic save mỗi 5s — lưu messages vào DB để refresh không mất
  const saveInterval = setInterval(() => {
    try {
      if (state.messages.length > 0) {
        const lastMsg = state.messages[state.messages.length - 1];
        if (lastMsg.role === 'assistant') {
          persistMessage(sessionId, lastMsg);
        }
      }
    } catch (err) {
      logger.warn(`[Claude][${sessionId}] Periodic save failed:`, err);
    }
  }, 5000);

  // Watchdog 2 tầng: ép SDK trả result nếu CLI treo (Linux không tự exit).
  // - NGẮN (3s): sau assistant chỉ có text/thinking → khả năng cao là response cuối
  // - DÀI (15s): sau tool_use, system, user → tool đang chạy, cần thời gian
  // - SKIP: nếu đang chờ permission/AskUser → không giới hạn
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  let queryInstance: any = null;
  const WATCHDOG_SHORT_MS = 3_000;
  const WATCHDOG_LONG_MS = 15_000;

  const resetWatchdog = (ms: number = WATCHDOG_LONG_MS) => {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(async () => {
      // Skip nếu đang chờ user approve permission hoặc trả lời câu hỏi
      if (state.pendingPermission) {
        logger.debug(`[Claude][${sessionId}] Watchdog skipped — pending permission`);
        resetWatchdog(WATCHDOG_LONG_MS);
        return;
      }
      logger.warn(`[Claude][${sessionId}] Watchdog triggered (${ms}ms) — force interrupting`);
      try {
        if (queryInstance) await queryInstance.interrupt();
      } catch (e: any) {
        if (e?.message?.includes('Query closed') || e?.message?.includes('ProcessTransport')) {
          logger.debug(`[Claude][${sessionId}] Expected error after interrupt, ignoring`);
        } else {
          logger.warn(`[Claude][${sessionId}] interrupt() failed:`, e);
        }
      }
    }, ms);
  };
  resetWatchdog(WATCHDOG_LONG_MS);

  // ── Turn context — tích lũy blocks từ TẤT CẢ assistant events thành 1 message ──
  const processor = new QueryProcessor(sessionId, state, emitter);
  const ctx = {
    turnBlocks: [] as ContentBlock[],
    turnToolCalls: [] as ToolCall[],
    turnTextParts: [] as string[],
    turnMsgId: `turn-${Date.now()}`,
    turnModel: undefined as string | undefined,
    turnTokensTotal: { input: 0, output: 0 },
    turnStartedAt: Date.now(),
    activeTaskToolId: null as string | null,
    activeTaskAgentName: '',
    subAgentActivities: [] as SubAgentActivity[],
  };

  const startTime = Date.now();
  const getElapsed = () => `${Date.now() - startTime}ms`;

  try {
    logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] Starting sdk.query (string prompt)...`);
    // claude-agent-sdk: dùng string prompt trực tiếp, SDK tự đóng stdin → không treo pipe
    queryInstance = sdk.query({ prompt: message, options });

    // Restore stream timeout env sau khi query bắt đầu (Query constructor đã bắt giá trị)
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] sdk.query initiated, starting for-await loop`);

    let eventCount = 0;
    for await (const sdkMsg of queryInstance) {
      eventCount++;
      const type = sdkMsg.type as string;
      logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] SDK Event #${eventCount}: ${type}`);

      switch (type) {
        case 'system': {
          // System init — chờ tiếp, dùng watchdog dài
          resetWatchdog(WATCHDOG_LONG_MS);
          logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] System init details: session=${sdkMsg.session_id}, model=${sdkMsg.model}`);
          emitter.emit('system', { sessionId, data: sdkMsg });
          emitter.emit('status', { sessionId, status: 'thinking', startedAt: state.processingStartedAt });
          // Lấy model từ system event đầu tiên
          if (sdkMsg.model && !state.model) {
            state.model = sdkMsg.model;
            try { updateSession(sessionId, { model: state.model }); } catch { }
          }
          break;
        }

        case 'assistant': {
          handleAssistantEvent(sdkMsg, sessionId, state, emitter, processor, ctx);

          // Phân loại assistant event để chọn watchdog phù hợp:
          // - Có tool_use → tool sắp chạy → watchdog dài
          // - Có thinking → model đang suy nghĩ, có thể tiếp tục bằng tool_use → watchdog dài
          // - CHỈ có text (không thinking, không tool_use) → response cuối → watchdog ngắn
          const apiContent = (sdkMsg as any).message?.content;
          const hasToolUse = Array.isArray(apiContent) && apiContent.some((b: any) => b.type === 'tool_use');
          const hasThinking = Array.isArray(apiContent) && apiContent.some((b: any) => b.type === 'thinking');
          const hasText = Array.isArray(apiContent) && apiContent.some((b: any) => b.type === 'text');
          const isFinalText = hasText && !hasToolUse && !hasThinking;
          resetWatchdog(isFinalText ? WATCHDOG_SHORT_MS : WATCHDOG_LONG_MS);
          break;
        }

        case 'user': {
          // Tool result trả về → có thể còn tiếp → watchdog dài
          resetWatchdog(WATCHDOG_LONG_MS);
          // SDK trả user event chứa tool_result — cần xử lý cho sub-agent
          const uMsg = (sdkMsg as any).message;
          if (uMsg?.content) {
            const blocks = Array.isArray(uMsg.content) ? uMsg.content : [uMsg.content];
            for (const b of blocks) {
              if (b.type === 'tool_result') processor.handleToolResult(b, ctx);
            }
          }
          break;
        }

        case 'result': {
          // Nhận result → clear watchdog ngay
          if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
          logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] Final result event received`);
          handleResultEvent(sdkMsg, sessionId, state, emitter, ctx, queryInstance);
          break;
        }

        default: {
          resetWatchdog(WATCHDOG_LONG_MS);
          emitter.emit('raw', { sessionId, event: sdkMsg });
          break;
        }
      }
    }
    logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] for-await loop finished naturally`);
  } catch (err: any) {
    // Phân biệt abort error (user chủ động) vs runtime error
    if (err.name === 'AbortError' || abortController.signal.aborted) {
      logger.info(`[Claude] Query aborted for ${sessionId}`);
    } else {
      throw err;
    }
  } finally {
    // Dọn dẹp watchdog bất kể thoát kiểu gì
    if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
    clearInterval(saveInterval);
    state.abortController = undefined;
    state.pendingPermission = undefined;
    if (state.isProcessing) {
      logger.warn(`[Claude][${sessionId}] finally: isProcessing still true — forcing idle`);
      state.isProcessing = false;
      emitter.emit('status', { sessionId, status: 'idle' });
    }
  }
}

// ─── Event Handlers (tách để giữ switch/case gọn) ────────────────────────

/**
 * Xử lý assistant event — tích lũy blocks vào ctx, KHÔNG finalize ngay.
 * SDK tách 1 lượt (thinking → tool_use → tool_result → text) thành nhiều
 * assistant events riêng. Ta gom lại để UI hiển thị gọn 1 message.
 */
function handleAssistantEvent(
  sdkMsg: any,
  sessionId: string,
  state: ClaudeSessionState,
  emitter: EventEmitter,
  processor: QueryProcessor,
  ctx: any,
): void {
  const apiMsg = sdkMsg.message;
  if (!apiMsg || !apiMsg.content) return;

  logger.info(`[Claude][${sessionId}] assistant event (accumulated ${ctx.turnBlocks.length} blocks so far)`);

  // Lấy ID từ API event đầu tiên
  if (apiMsg.id && ctx.turnMsgId.startsWith('turn-')) ctx.turnMsgId = apiMsg.id;
  if (apiMsg.model) ctx.turnModel = apiMsg.model;
  if (apiMsg.usage) {
    ctx.turnTokensTotal.input += apiMsg.usage.input_tokens || 0;
    ctx.turnTokensTotal.output += apiMsg.usage.output_tokens || 0;
  }

  for (const block of apiMsg.content) {
    if (block.type === 'text' && block.text) {
      ctx.turnTextParts.push(block.text);
      ctx.turnBlocks.push({ type: 'text', text: block.text });
      emitter.emit('stream', {
        sessionId,
        content: block.text,
        messageId: `msg-${sessionId}-streaming`,
      });
    } else if (block.type === 'thinking') {
      const thinkingText = (block as any).thinking || (block as any).thought || (typeof (block as any).content === 'string' ? (block as any).content : '');
      if (thinkingText) {
        ctx.turnBlocks.push({ type: 'thinking', thinking: thinkingText });
        logger.info(`[Claude][${sessionId}] Thinking block (len: ${thinkingText.length})`);
      }
    } else if (block.type === 'tool_use') {
      const tc: ToolCall = {
        id: block.id || uuidv4(),
        name: block.name || 'unknown',
        input: block.input || {},
      };

      // Sub-agent: tool 'Agent' (hoặc 'Task' ở phiên bản cũ) → bắt đầu tracking
      const toolNameLower = block.name?.toLowerCase();
      if (toolNameLower === 'agent' || toolNameLower === 'task') {
        ctx.activeTaskToolId = tc.id;
        ctx.activeTaskAgentName = block.input?.subagent_type || block.input?.agent_type || block.input?.type || 'Sub Agent';
        ctx.turnBlocks.push({ type: 'tool_use', tool: tc });
        emitter.emit('subagent:started', { sessionId, agentName: ctx.activeTaskAgentName, prompt: block.input?.description || '' });
      } else if (ctx.activeTaskToolId) {
        // Tool call nội bộ của sub-agent — chỉ track, không hiện trên timeline chính
        ctx.subAgentActivities.push({ name: tc.name, input: tc.input });
      } else {
        // Tool call bình thường
        ctx.turnToolCalls.push(tc);
        ctx.turnBlocks.push({ type: 'tool_use', tool: tc });
        emitter.emit('stream:tool', { sessionId, tool: tc });
        emitter.emit('status', { sessionId, status: 'tool_use', toolName: tc.name });
      }
    } else if (block.type === 'tool_result') {
      processor.handleToolResult(block, ctx);
    } else {
      logger.debug(`[Claude][${sessionId}] Unhandled block type: ${block.type}`);
    }
  }

  // Cập nhật model cho session
  if (ctx.turnModel && !state.model) {
    state.model = ctx.turnModel;
    try { updateSession(sessionId, { model: state.model }); } catch { }
  }
}

/**
 * Xử lý result event — finalize message, xử lý error/completion, cleanup.
 */
function handleResultEvent(
  sdkMsg: any,
  sessionId: string,
  state: ClaudeSessionState,
  emitter: EventEmitter,
  ctx: any,
  queryInstance: any,
): void {
  const result = sdkMsg as any;
  const costUsd = result.total_cost_usd || 0;
  const durationMs = result.duration_ms || 0;
  const usage = result.usage;

  if (result.is_error) {
    logger.error(`[Claude] Result error:`, JSON.stringify(result, null, 2));
  }

  // ── Finalize 1 message duy nhất từ TẤT CẢ accumulated blocks ──
  if (ctx.turnBlocks.length > 0) {
    const totalDurationMs = Date.now() - ctx.turnStartedAt;
    const finalTokens = usage && (usage.input_tokens > 0 || usage.output_tokens > 0)
      ? { input: usage.input_tokens || 0, output: usage.output_tokens || 0 }
      : (ctx.turnTokensTotal.input > 0 || ctx.turnTokensTotal.output > 0) ? ctx.turnTokensTotal : undefined;

    const chatMsg: ChatMessage = {
      id: ctx.turnMsgId,
      role: 'assistant',
      content: ctx.turnTextParts.join('\n'),
      blocks: ctx.turnBlocks,
      toolCalls: ctx.turnToolCalls.length > 0 ? ctx.turnToolCalls : undefined,
      timestamp: new Date().toISOString(),
      model: ctx.turnModel,
      tokens: finalTokens,
      durationMs: durationMs > 0 ? durationMs : totalDurationMs,
      cost: costUsd > 0 ? costUsd : undefined,
    };
    finalizeAssistantMessage(sessionId, chatMsg, state, emitter);
    logger.info(`[Claude][${sessionId}] ✅ Finalized: ${ctx.turnBlocks.length} blocks, ${ctx.turnToolCalls.length} tools`);
  }

  // System messages cho error / completion
  if (result.is_error || result.subtype === 'error_max_turns' || result.subtype === 'error_during_execution') {
    const errorDetail = result.result || result.message || JSON.stringify(result);
    const errorMsg: ChatMessage = {
      id: `result-${Date.now()}`,
      role: 'system',
      content: `Error: ${errorDetail}`,
      timestamp: new Date().toISOString(),
    };
    state.messages.push(errorMsg);
    persistMessage(sessionId, errorMsg);
    emitter.emit('result', { sessionId, result: errorMsg, data: result });
  } else if (costUsd > 0 || durationMs > 1000) {
    const finalMsg: ChatMessage = {
      id: `result-${Date.now()}`,
      role: 'system',
      content: `Completed: ${(durationMs / 1000).toFixed(1)}s · $${costUsd.toFixed(4)}`,
      timestamp: new Date().toISOString(),
      cost: costUsd,
    };
    state.messages.push(finalMsg);
    persistMessage(sessionId, finalMsg);
    emitter.emit('result', { sessionId, result: finalMsg, data: result });
  }

  if (result.permission_denials && result.permission_denials.length > 0) {
    logger.warn(`[Claude][${sessionId}] Permission denials:`, result.permission_denials);
  }

  state.isProcessing = false;
  state.pendingPermission = undefined;
  emitter.emit('status', { sessionId, status: 'idle' });

  // Interrupt stream sau khi xong — cleanup resources (claude-agent-sdk)
  try {
    if (queryInstance) queryInstance.interrupt();
  } catch { /* ignore — stream có thể đã kết thúc */ }
}
