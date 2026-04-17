import { EventEmitter } from 'events';
import { updateSession } from '../../session';
import { logger } from '../../logger';
import { ClaudeSessionState } from '../types';
import { QueryProcessor } from '../processor';
import { TurnContext } from './eventHandlers';

interface SystemEventContext {
  sessionId: string;
  state: ClaudeSessionState;
  emitter: EventEmitter;
  sdkMsg: any;
  getElapsed: () => string;
  processingStartedAt?: number;
  setMcpInitPending: (v: boolean) => void;
}

interface StreamEventContext {
  sessionId: string;
  state: ClaudeSessionState;
  emitter: EventEmitter;
  sdkMsg: any;
  ctx: TurnContext;
  processor: QueryProcessor;
  hasLinuxCompletionToken: (text: string) => boolean;
  hasLinuxCompletionTokenAcrossStreamChunks: (chunk: string) => boolean;
  interruptForLinuxCompletion: (source: 'stream_event' | 'assistant') => void;
}

/**
 * Xử lý system event từ SDK.
 *
 * Why:
 * - Gom logic subtype vào 1 nơi.
 * - Giảm kích thước switch chính trong sdkRunner.
 */
export function handleSystemEvent(ctx: SystemEventContext): void {
  const { sessionId, state, emitter, sdkMsg, getElapsed, setMcpInitPending } = ctx;

  const subtype = (sdkMsg as any).subtype as string;
  logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] System event: subtype=${subtype || 'init'}, session=${sdkMsg.session_id}, model=${sdkMsg.model}`);

  if (subtype === 'compact_boundary') {
    const compactMeta = (sdkMsg as any).compact_metadata;
    logger.info(`[Claude][${sessionId}] Context compacted: ${compactMeta?.pre_tokens} → ${compactMeta?.post_tokens} tokens`);
    emitter.emit('compact:boundary', {
      sessionId,
      trigger: compactMeta?.trigger,
      preTokens: compactMeta?.pre_tokens,
      postTokens: compactMeta?.post_tokens,
    });
  } else if (subtype === 'task_started') {
    const taskId = (sdkMsg as any).task_id;
    const description = (sdkMsg as any).description;
    const taskType = (sdkMsg as any).task_type;
    logger.info(`[Claude][${sessionId}] Task started: ${taskId} (${taskType}) — ${description}`);
    emitter.emit('task:start', { sessionId, taskId, description, taskType });
  } else if (subtype === 'task_updated') {
    emitter.emit('task:update', { sessionId, taskId: (sdkMsg as any).task_id });
  } else {
    emitter.emit('system', { sessionId, data: sdkMsg });
    state.activeToolName = undefined;
    emitter.emit('status', { sessionId, status: 'thinking', startedAt: state.processingStartedAt });
  }

  const mcpServers = (sdkMsg as any).mcp_servers;
  if (Array.isArray(mcpServers) && mcpServers.length > 0) {
    const statusSummary = mcpServers.map((s: any) => `${s.name}=${s.status}`).join(', ');
    logger.info(`[Claude][${sessionId}] MCP status (subtype=${(sdkMsg as any).subtype || 'init'}): ${statusSummary}`);

    const hasResolvedStatus = mcpServers.some((s: any) => s.status !== 'pending');
    emitter.emit('mcp:status', {
      sessionId,
      servers: mcpServers.map((s: any) => ({
        name: s.name || 'unknown',
        status: s.status || 'unknown',
        serverInfo: s.serverInfo || null,
        tools: Array.isArray(s.tools) ? s.tools : [],
        error: s.error || null,
      })),
      allResolved: hasResolvedStatus,
    });

    if (!hasResolvedStatus) {
      setMcpInitPending(true);
    }
  }

  if (sdkMsg.model && !state.model) {
    state.model = sdkMsg.model;
    try { updateSession(sessionId, { model: state.model }); } catch { }
  }
}

/**
 * Xử lý stream_event (partial messages) từ SDK.
 *
 * Why:
 * - Tách block dài ra khỏi sdkRunner.ts.
 * - Giữ logic live preview text/tool input tập trung.
 */
export function handleStreamEvent(args: StreamEventContext): void {
  const {
    sessionId,
    state,
    emitter,
    sdkMsg,
    ctx,
    processor,
    hasLinuxCompletionToken,
    hasLinuxCompletionTokenAcrossStreamChunks,
    interruptForLinuxCompletion,
  } = args;

  const parentId = (sdkMsg as any).parent_tool_use_id || null;
  const rawEvent = (sdkMsg as any).event;
  if (!rawEvent) return;
  const evType = rawEvent.type as string;

  // Stream events của sub-agent
  if (parentId) {
    const upsertSubAgentLiveBlock = (opts?: { appendText?: string; toolName?: string }) => {
      const idx = ctx.turnBlocks.findIndex((b: any) =>
        b.type === 'subagent_result' && b.parentToolUseId === parentId,
      );
      const existing = idx >= 0 ? (ctx.turnBlocks[idx] as any) : null;
      const currentText = ctx.subAgentLiveTextMap.get(parentId) || '';
      const nextText = opts?.appendText ? `${currentText}${opts.appendText}` : currentText;
      ctx.subAgentLiveTextMap.set(parentId, nextText);

      const activities = ctx.subAgentActivityMap.get(parentId) || existing?.activities || [];
      const fallbackText = opts?.toolName
        ? `Đang chạy ${opts.toolName}...`
        : activities.length > 0
          ? `Đang chạy ${activities[activities.length - 1].name}...`
          : 'Đang thực thi...';

      const nextBlock = {
        type: 'subagent_result' as const,
        agentName: ctx.subAgentNames.get(parentId) || existing?.agentName || state.activeSubAgent?.name || 'Sub Agent',
        result: nextText.trim() || existing?.result || fallbackText,
        isError: existing?.isError,
        activities: [...activities],
        usage: existing?.usage,
        agentId: existing?.agentId,
        parentToolUseId: parentId,
      };

      if (idx >= 0) ctx.turnBlocks[idx] = nextBlock;
      else ctx.turnBlocks.push(nextBlock);

      state.partialAssistantBlocks = [...ctx.turnBlocks];
      state.partialToolCalls = [...ctx.turnToolCalls];
      state.partialAssistantContent = ctx.turnTextParts.join('');
      emitter.emit('stream:blocks', {
        sessionId,
        blocks: ctx.turnBlocks,
      });
    };

    if (evType === 'content_block_start') {
      const cb = rawEvent.content_block;
      if (cb?.type === 'tool_use') {
        ctx.subAgentStreamEventParents.add(parentId);
        if (state.activeSubAgent) {
          state.activeSubAgent = {
            ...state.activeSubAgent,
            currentToolName: cb.name || 'unknown',
            lastHeartbeat: Date.now(),
          };
        }
        const toolName = cb.name || 'unknown';
        const toolId = cb.id || '';
        const activities = ctx.subAgentActivityMap.get(parentId) || [];
        if (!activities.some((a: any) => a.toolId && toolId && a.toolId === toolId)) {
          activities.push({ toolId, name: toolName, input: {} });
          ctx.subAgentActivityMap.set(parentId, activities);
        }

        upsertSubAgentLiveBlock({ toolName });
        emitter.emit('subagent:activity', {
          sessionId,
          parentToolUseId: parentId,
          type: 'tool_start',
          toolName,
          toolId,
        });
      }
    } else if (evType === 'content_block_delta') {
      const delta = rawEvent.delta;
      if (delta?.type === 'text_delta' && delta.text) {
        ctx.subAgentStreamEventParents.add(parentId);
        if (state.activeSubAgent) {
          state.activeSubAgent = {
            ...state.activeSubAgent,
            lastHeartbeat: Date.now(),
          };
        }
        upsertSubAgentLiveBlock({ appendText: delta.text });
        emitter.emit('subagent:activity', {
          sessionId,
          parentToolUseId: parentId,
          type: 'text_delta',
          text: delta.text,
        });
      }
    }
    return;
  }

  ctx.hasReceivedStreamEvents = true;

  if (evType === 'content_block_start') {
    const cb = rawEvent.content_block;
    if (!cb) return;
    const blockIndex = rawEvent.index ?? 0;

    if (cb.type === 'tool_use') {
      ctx.activeStreamBlock = {
        index: blockIndex,
        type: 'tool_use',
        toolName: cb.name || 'unknown',
        toolId: cb.id || '',
        accumulatedInput: '',
      };
      emitter.emit('stream:block_start', {
        sessionId,
        blockIndex,
        blockType: 'tool_use',
        toolName: cb.name,
        toolId: cb.id,
      });
    } else if (cb.type === 'thinking') {
      ctx.activeStreamBlock = { index: blockIndex, type: 'thinking' };
      emitter.emit('stream:block_start', {
        sessionId,
        blockIndex,
        blockType: 'thinking',
      });
    } else if (cb.type === 'text') {
      ctx.activeStreamBlock = { index: blockIndex, type: 'text' };
    }
    return;
  }

  if (evType === 'content_block_delta') {
    const delta = rawEvent.delta;
    if (!delta) return;

    if (delta.type === 'text_delta' && delta.text) {
      const streamText = delta.text;
      if (hasLinuxCompletionTokenAcrossStreamChunks(streamText) || hasLinuxCompletionToken(streamText)) {
        interruptForLinuxCompletion('stream_event');
      }
      if (streamText) {
        ctx.streamedMainTextChunks.push(streamText);
        emitter.emit('stream', {
          sessionId,
          content: streamText,
          messageId: `msg-${sessionId}-streaming`,
        });
      }
    } else if (delta.type === 'input_json_delta' && ctx.activeStreamBlock?.type === 'tool_use') {
      const chunk = delta.partial_json || '';
      ctx.activeStreamBlock.accumulatedInput = (ctx.activeStreamBlock.accumulatedInput || '') + chunk;
      emitter.emit('stream:block_delta', {
        sessionId,
        blockIndex: ctx.activeStreamBlock.index,
        deltaType: 'input_json_delta',
        chunk,
        accumulated: ctx.activeStreamBlock.accumulatedInput,
        toolName: ctx.activeStreamBlock.toolName,
      });
    } else if (delta.type === 'thinking_delta' && ctx.activeStreamBlock?.type === 'thinking') {
      const thinkingChunk = delta.thinking || '';
      emitter.emit('stream:block_delta', {
        sessionId,
        blockIndex: ctx.activeStreamBlock.index,
        deltaType: 'thinking_delta',
        chunk: thinkingChunk,
      });
    }
    return;
  }

  if (evType === 'content_block_stop') {
    if (!ctx.activeStreamBlock) return;
    emitter.emit('stream:block_stop', {
      sessionId,
      blockIndex: ctx.activeStreamBlock.index,
      blockType: ctx.activeStreamBlock.type,
      toolName: ctx.activeStreamBlock.type === 'tool_use' ? ctx.activeStreamBlock.toolName : undefined,
      streamingInput: ctx.activeStreamBlock.type === 'tool_use' ? ctx.activeStreamBlock.accumulatedInput : undefined,
    });
    ctx.activeStreamBlock = null;
    return;
  }

  // message_start/message_delta/message_stop: intentionally ignore
}

/**
 * Xử lý user event chứa tool_result để cập nhật blocks ngay.
 */
export function handleUserEvent(
  sessionId: string,
  sdkMsg: any,
  processor: QueryProcessor,
  ctx: TurnContext,
  state: ClaudeSessionState,
  emitter: EventEmitter,
): void {
  const uParentId = (sdkMsg as any).parent_tool_use_id || null;
  const uMsg = (sdkMsg as any).message;
  if (!uMsg?.content) return;

  const blocks = Array.isArray(uMsg.content) ? uMsg.content : [uMsg.content];
  for (const b of blocks) {
    if (b.type === 'tool_result') processor.handleToolResult(b, ctx, uParentId);
  }

  if (!uParentId) {
    state.partialAssistantBlocks = [...ctx.turnBlocks];
    state.partialToolCalls = [...ctx.turnToolCalls];
    state.partialAssistantContent = ctx.turnTextParts.join('');
    emitter.emit('stream:blocks', {
      sessionId,
      blocks: ctx.turnBlocks,
    });
  }
}
