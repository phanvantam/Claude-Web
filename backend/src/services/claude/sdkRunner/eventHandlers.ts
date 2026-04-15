/**
 * Xử lý các event chính từ SDK stream: assistant và result.
 *
 * Tách ra từ sdkRunner.ts gốc để giảm kích thước file orchestration chính.
 * Các hàm ở đây nhận context (ctx) và state qua tham số, không bind this.
 */

import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { ChatMessage, ToolCall, ContentBlock } from '../../../types';
import { updateSession, getSession } from '../../session';
import { getProject } from '../../project';
import { logger } from '../../logger';
import { ClaudeSessionState } from '../types';
import { QueryProcessor } from '../processor';
import { persistMessage, finalizeAssistantMessage } from '../messageHelpers';
import { extractToolInputSummary } from './helpers';

/**
 * Context tích lũy trong suốt 1 lượt query — gom blocks từ nhiều assistant events
 * thành 1 message duy nhất khi finalize.
 */
export interface TurnContext {
  turnBlocks: ContentBlock[];
  turnToolCalls: ToolCall[];
  turnTextParts: string[];
  turnMsgId: string;
  turnModel: string | undefined;
  turnTokensTotal: { input: number; output: number };
  turnStartedAt: number;
  subAgentActivityMap: Map<string, any[]>;
  subAgentNames: Map<string, string>;
  activeStreamBlock: {
    index: number;
    type: 'text' | 'thinking' | 'tool_use';
    toolName?: string;
    toolId?: string;
    accumulatedInput?: string;
  } | null;
  hasReceivedStreamEvents: boolean;
}

/**
 * Xử lý assistant event — tích lũy blocks vào ctx, KHÔNG finalize ngay.
 * SDK tách 1 lượt (thinking → tool_use → tool_result → text) thành nhiều
 * assistant events riêng. Ta gom lại để UI hiển thị gọn 1 message.
 *
 * parentToolUseId: SDK trả trường này nếu message nằm trong context của sub-agent.
 * Dùng nó để phân biệt message chính vs message nội bộ sub-agent — thay vì
 * tự track activeTaskToolId thủ công.
 */
export function handleAssistantEvent(
  sdkMsg: any,
  sessionId: string,
  state: ClaudeSessionState,
  emitter: EventEmitter,
  processor: QueryProcessor,
  ctx: TurnContext,
  parentToolUseId: string | null,
): void {
  const syncPartialTurnToState = () => {
    state.partialAssistantBlocks = [...ctx.turnBlocks];
    state.partialToolCalls = [...ctx.turnToolCalls];
    state.partialAssistantContent = ctx.turnTextParts.join('');
  };
  const apiMsg = sdkMsg.message;
  if (!apiMsg || !apiMsg.content) return;

  const isInsideSubAgent = !!parentToolUseId;
  logger.info(`[Claude][${sessionId}] assistant event (blocks=${ctx.turnBlocks.length}, insideSubAgent=${isInsideSubAgent})`);

  // Lấy ID từ API event đầu tiên (chỉ từ message chính, không phải sub-agent)
  if (!isInsideSubAgent) {
    if (apiMsg.id && ctx.turnMsgId.startsWith('turn-')) ctx.turnMsgId = apiMsg.id;
    if (apiMsg.model) ctx.turnModel = apiMsg.model;
  }
  if (apiMsg.usage) {
    ctx.turnTokensTotal.input += apiMsg.usage.input_tokens || 0;
    ctx.turnTokensTotal.output += apiMsg.usage.output_tokens || 0;
  }

  // Khi hasReceivedStreamEvents = true, stream_event đã gửi delta trực tiếp cho frontend.
  // Assistant event chỉ cần tích lũy vào ctx (cho finalize), KHÔNG emit stream nữa.
  const skipEmit = ctx.hasReceivedStreamEvents && !isInsideSubAgent;


  for (const block of apiMsg.content) {
    if (block.type === 'text' && block.text) {
      if (isInsideSubAgent) {
        // Text từ sub-agent — không stream lên timeline chính
        logger.debug(`[Claude][${sessionId}] Sub-agent text (parent=${parentToolUseId}, len=${block.text.length})`);
      } else {
        ctx.turnTextParts.push(block.text);
        ctx.turnBlocks.push({ type: 'text', text: block.text });
        syncPartialTurnToState();
        // Chỉ emit khi CHƯA có stream_event xử lý (fallback)
        if (!skipEmit) {
          emitter.emit('stream', {
            sessionId,
            content: block.text,
            messageId: `msg-${sessionId}-streaming`,
          });
        }
      }
    } else if (block.type === 'thinking') {
      const thinkingText = (block as any).thinking || (block as any).thought || (typeof (block as any).content === 'string' ? (block as any).content : '');
      if (thinkingText && !isInsideSubAgent) {
        ctx.turnBlocks.push({ type: 'thinking', thinking: thinkingText });
        syncPartialTurnToState();
        logger.info(`[Claude][${sessionId}] Thinking block (len: ${thinkingText.length})`);
      }
    } else if (block.type === 'tool_use') {
      const tc: ToolCall = {
        id: block.id || uuidv4(),
        name: block.name || 'unknown',
        input: block.input || {},
      };

      // Sub-agent invocation: tool 'Agent' (hoặc 'Task' ở SDK cũ)
      const toolNameLower = block.name?.toLowerCase();
      if (toolNameLower === 'agent' || toolNameLower === 'task') {
        const agentName = block.input?.subagent_type || block.input?.agent_type || block.input?.type || 'Sub Agent';
        ctx.subAgentNames.set(tc.id, agentName);
        ctx.subAgentActivityMap.set(tc.id, []);
        ctx.turnBlocks.push({ type: 'tool_use', tool: tc });
        syncPartialTurnToState();
        state.activeSubAgent = {
          name: agentName,
          prompt: block.input?.description || '',
          lastHeartbeat: Date.now(),
          activities: [],
        };
        emitter.emit('subagent:started', { sessionId, agentName, prompt: block.input?.description || '' });
      } else if (isInsideSubAgent) {
        // Tool call nội bộ của sub-agent — track activity + emit cho frontend live preview
        const activities = ctx.subAgentActivityMap.get(parentToolUseId) || [];
        activities.push({ name: tc.name, input: tc.input });
        ctx.subAgentActivityMap.set(parentToolUseId, activities);
        // Emit ngay để frontend cập nhật phần mở rộng Agent card
        // Extract thông tin chính từ input để hiển thị chi tiết
        const inputSummary = extractToolInputSummary(tc.name, tc.input);
        if (state.activeSubAgent) {
          state.activeSubAgent = {
            ...state.activeSubAgent,
            lastHeartbeat: Date.now(),
            currentToolName: tc.name,
            activities: [
              ...(state.activeSubAgent.activities || []),
              { toolName: tc.name, inputSummary, timestamp: Date.now() },
            ],
          };
        }
        emitter.emit('subagent:activity', {
          sessionId,
          parentToolUseId,
          type: 'tool_start',
          toolName: tc.name,
          toolId: tc.id,
          inputSummary,
        });
      } else {
        // Tool call bình thường — tích lũy vào ctx
        ctx.turnToolCalls.push(tc);
        ctx.turnBlocks.push({ type: 'tool_use', tool: tc });
        syncPartialTurnToState();
        // Chỉ emit stream:tool khi CHƯA có stream_event (fallback)
        if (!skipEmit) {
          emitter.emit('stream:tool', { sessionId, tool: tc });
        }
        // Status luôn emit — cập nhật thanh trạng thái bất kể stream mode
        state.activeToolName = tc.name;
        emitter.emit('status', { sessionId, status: 'tool_use', toolName: tc.name });
      }
    } else if (block.type === 'tool_result') {
      processor.handleToolResult(block, ctx, parentToolUseId);
      syncPartialTurnToState();
      // Tool đã hoàn thành → xóa activeToolName để Dynamic Watchdog
      // chuyển về timeout ngắn (10s). Nếu không xóa, watchdog sẽ bị
      // "lừa" rằng tool vẫn đang chạy và giữ timeout dài (10 phút).
      if (!isInsideSubAgent) {
        state.activeToolName = undefined;
        emitter.emit('stream:blocks', {
          sessionId,
          blocks: ctx.turnBlocks,
        });
      }
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
export function handleResultEvent(
  sdkMsg: any,
  sessionId: string,
  state: ClaudeSessionState,
  emitter: EventEmitter,
  ctx: TurnContext,
  queryInstance: any,
): void {
  const result = sdkMsg as any;
  const costUsd = result.total_cost_usd || 0;
  const durationMs = result.duration_ms || 0;
  const usage = result.usage;
  const hasTerminalMessage = !!result.is_error || costUsd > 0 || durationMs > 1000;

  if (!hasTerminalMessage) {
    logger.info(`[Claude][${sessionId}] Result without terminal system message (cost=${costUsd}, durationMs=${durationMs})`);
  }

  // Cộng dồn chi phí vào sessions.total_cost
  if (costUsd > 0) {
    try {
      const existing = getSession(sessionId);
      const prevCost = existing?.totalCost ?? 0;
      updateSession(sessionId, { totalCost: prevCost + costUsd });
      logger.info(`[Claude][${sessionId}] totalCost updated: ${prevCost} + ${costUsd} = ${prevCost + costUsd}`);
    } catch (e) {
      logger.warn(`[Claude][${sessionId}] Failed to update totalCost:`, e);
    }
  }

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
    logger.info(`[Claude][${sessionId}] Finalized: ${ctx.turnBlocks.length} blocks, ${ctx.turnToolCalls.length} tools`);
  }

  // Phân tích xem có phải là lỗi do người dùng chủ động dừng (Stop) hay không
  const isAbort = result.terminal_reason === 'aborted_streaming' ||
    (Array.isArray(result.errors) && result.errors.some((e: any) => String(e).includes('Request was aborted')));

  const completedByModelSessionEndKey = state.interruptReason === 'linux_completion_token';
  const completionReasonLabel = completedByModelSessionEndKey
    ? `Hoàn thành do model gửi key kết thúc phiên: ${(durationMs / 1000).toFixed(1)}s · $${costUsd.toFixed(4)}`
    : `Hoàn thành: ${(durationMs / 1000).toFixed(1)}s · $${costUsd.toFixed(4)}`;

  const abortReasonLabel = state.interruptReason === 'user_abort'
    ? 'Đã dừng theo thao tác bấm Dừng của người dùng.'
    : state.interruptReason === 'watchdog_timeout'
      ? 'Đã dừng do hết thời gian chờ (timeout) vì không còn dữ liệu mới.'
      : 'Đã dừng do tiến trình bị ngắt.';

  // System messages cho error / completion / abort
  if (completedByModelSessionEndKey && isAbort) {
    const completionMsg: ChatMessage = {
      id: `result-${Date.now()}`,
      role: 'system',
      content: completionReasonLabel,
      timestamp: new Date().toISOString(),
      cost: costUsd,
    };
    state.messages.push(completionMsg);
    persistMessage(sessionId, completionMsg);
    emitter.emit('result', { sessionId, result: completionMsg, data: result });
  } else if (isAbort) {
    const abortMsg: ChatMessage = {
      id: `result-${Date.now()}`,
      role: 'system',
      content: abortReasonLabel,
      timestamp: new Date().toISOString(),
      cost: costUsd,
    };
    state.messages.push(abortMsg);
    persistMessage(sessionId, abortMsg);
    emitter.emit('result', { sessionId, result: abortMsg, data: result });
  } else if (result.is_error || result.subtype === 'error_max_turns' || result.subtype === 'error_max_budget_usd' || result.subtype === 'error_during_execution') {
    // Lấy thông tin lỗi chi tiết hơn, tránh JSON.stringify thô nếu có thể
    let errorDetail = result.result || result.message;
    if (!errorDetail && Array.isArray(result.errors) && result.errors.length > 0) {
      // Ưu tiên dòng đầu tiên của errors (thường là summary)
      errorDetail = String(result.errors[0]).split('\n')[0];
    }
    if (!errorDetail) errorDetail = result.subtype || 'Unknown execution error';

    const errorMsg: ChatMessage = {
      id: `result-${Date.now()}`,
      role: 'system',
      content: `Lỗi: ${errorDetail}`,
      timestamp: new Date().toISOString(),
    };
    state.messages.push(errorMsg);
    persistMessage(sessionId, errorMsg);
    emitter.emit('result', { sessionId, result: errorMsg, data: result });
  } else if (costUsd > 0 || durationMs > 1000) {
    const finalMsg: ChatMessage = {
      id: `result-${Date.now()}`,
      role: 'system',
      content: completionReasonLabel,
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
  state.activeToolName = undefined;
  state.activeSubAgent = undefined;
  state.partialAssistantBlocks = undefined;
  state.partialToolCalls = undefined;
  state.partialAssistantContent = undefined;
  state.interruptReason = undefined;
  emitter.emit('status', { sessionId, status: 'idle' });

  // Interrupt stream sau khi xong — cleanup resources (claude-agent-sdk)
  try {
    if (queryInstance) queryInstance.interrupt();
  } catch { /* ignore — stream có thể đã kết thúc */ }
}

