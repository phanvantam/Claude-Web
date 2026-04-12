import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { ChatMessage, ToolCall, ContentBlock, SubAgentActivity } from '../../types';
import { updateSession } from '../session';
import { getMcpServersDetailed, buildSDKAgentDefinitions } from '../claude-meta';
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

  // ── allowedTools: LUÔN truyền mỗi lần query ──
  // Đây là runtime permission, SDK KHÔNG lưu vào settings.
  // Nếu thiếu → Claude thấy MCP tools nhưng KHÔNG ĐƯỢC PHÉP gọi.
  try {
    const mcpData = getMcpServersDetailed(config.cwd);
    const mergedMcp = { ...mcpData.global, ...mcpData.project };
    if (Object.keys(mergedMcp).length > 0) {
      const mcpAllowedTools = Object.keys(mergedMcp).map(name => `mcp__${name}__*`);
      options.allowedTools = [...(options.allowedTools || []), ...mcpAllowedTools];
      logger.info(`[Claude][${sessionId}] MCP allowedTools: ${mcpAllowedTools.join(', ')}`);
    }
  } catch (err) {
    logger.warn(`[Claude][${sessionId}] Failed to build MCP allowedTools:`, err);
  }

  if (isResume) {
    // Resume session — SDK tự đọc mcpServers từ ~/.claude.json (settingSources).
    // KHÔNG truyền lại mcpServers/agents để tránh khởi tạo lại MCP mỗi lần chat.
    options.resume = sessionId;
    logger.info(`[Claude][${sessionId}] Resuming — bỏ qua mcpServers/agents (SDK tự đọc từ settings)`);
  } else {
    // Session mới — truyền đầy đủ MCP servers + agent definitions
    options.sessionId = sessionId;

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

    // Nạp Agent Definitions vào SDK — SDK tự điều phối tool Agent/Task
    try {
      const agentDefs = buildSDKAgentDefinitions(config.cwd);
      const agentCount = Object.keys(agentDefs).length;
      if (agentCount > 0) {
        options.agents = agentDefs;
        logger.info(`[Claude][${sessionId}] Injected ${agentCount} agent definitions: ${Object.keys(agentDefs).join(', ')}`);
      }
    } catch (err) {
      logger.warn(`[Claude][${sessionId}] Failed to load agent definitions:`, err);
    }
  }
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
  // systemPrompt: KHÔNG ghi đè preset claude_code — luôn giữ hành vi gốc.
  // Nếu config.systemPrompt được truyền, nối thêm (append) vào sau preset.
  if (config.systemPrompt) {
    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: config.systemPrompt,
    };
  }

  // SDK tự quản lý giới hạn vòng đời — không cần watchdog timer cứng.
  // maxTurns: ngăn vòng lặp vô tận → SDK trả error_max_turns.
  // maxBudgetUsd: kiểm soát chi phí → SDK trả error_max_budget_usd.
  if (config.maxTurns) options.maxTurns = config.maxTurns;
  if (config.maxBudgetUsd) options.maxBudgetUsd = config.maxBudgetUsd;

  // Bật tính năng tự động của SDK:
  // - agentProgressSummaries: nhận heartbeat mỗi ~30s từ sub-agent đang chạy
  // - promptSuggestions: gợi ý câu hỏi tiếp theo sau mỗi lượt
  // - includePartialMessages: nhận stream_event với các delta mức độ hạt
  //   (content_block_start, content_block_delta, content_block_stop)
  //   cho phép live preview tool input và text streaming tức thì
  options.agentProgressSummaries = true;
  options.promptSuggestions = true;
  options.includePartialMessages = true;

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

  // ── Safety net duy nhất: Global timeout 10 phút ──
  // SDK đã tự quản lý vòng đời (maxTurns, maxBudgetUsd, internal retry ~10min).
  // Timer này CHỈ bắt trường hợp CLI crash/zombie thực sự — không can thiệp vào
  // quá trình suy luận sâu (effort: high) hoặc sub-agent đang chạy.
  // Dữ liệu tham khảo:
  //   - SDK internal stream timeout: ~10 phút (GitHub Issue #533)
  //   - CLAUDE_CODE_STREAM_CLOSE_TIMEOUT: 300s (5 phút, đã set ở trên)
  //   - agentProgressSummaries: heartbeat mỗi ~30s từ sub-agent
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let queryInstance: any = null;
  const GLOBAL_SAFETY_TIMEOUT_MS = 600_000; // 10 phút

  const resetSafetyTimer = () => {
    if (safetyTimer) clearTimeout(safetyTimer);
    safetyTimer = setTimeout(async () => {
      // Skip nếu đang chờ user approve permission hoặc trả lời câu hỏi
      if (state.pendingPermission) {
        logger.debug(`[Claude][${sessionId}] Safety timer skipped — pending permission`);
        resetSafetyTimer();
        return;
      }
      logger.warn(`[Claude][${sessionId}] Global safety timeout (${GLOBAL_SAFETY_TIMEOUT_MS / 1000}s) — CLI có thể đã crash, force interrupting`);
      try {
        if (queryInstance) await queryInstance.interrupt();
      } catch (e: any) {
        if (e?.message?.includes('Query closed') || e?.message?.includes('ProcessTransport')) {
          logger.debug(`[Claude][${sessionId}] Expected error after interrupt, ignoring`);
        } else {
          logger.warn(`[Claude][${sessionId}] interrupt() failed:`, e);
        }
      }
    }, GLOBAL_SAFETY_TIMEOUT_MS);
  };
  resetSafetyTimer();

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
    // Map: parentToolUseId → danh sách activities nội bộ của sub-agent đó.
    // Dùng parent_tool_use_id từ SDK message thay vì manual tracking.
    subAgentActivityMap: new Map<string, SubAgentActivity[]>(),
    // Map: tool_use_id → agent name (để tra cứu khi kết thúc)
    subAgentNames: new Map<string, string>(),
    // Stream state: theo dõi các block đang được stream (live preview)
    // Key = blockIndex, Value = thông tin block đang tích lũy
    activeStreamBlock: null as {
      index: number;
      type: 'text' | 'thinking' | 'tool_use';
      toolName?: string;
      toolId?: string;
      accumulatedInput?: string; // JSON input đang tích lũy cho tool
    } | null,
    // Flag: đã nhận stream_event (includePartialMessages=true đang hoạt động).
    // Khi true → handleAssistantEvent sẽ KHÔNG emit stream events nữa (tránh duplicate)
    // vì stream_event đã gửi delta tới frontend rồi.
    hasReceivedStreamEvents: false,
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
    // Cờ: system init đã gửi MCP status = pending → cần resolve khi event tiếp theo đến
    let mcpInitPending = false;

    for await (const sdkMsg of queryInstance) {
      eventCount++;
      const type = sdkMsg.type as string;
      logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] SDK Event #${eventCount}: ${type}`);

      // Mọi event nhận được đều reset safety timer — chứng tỏ CLI còn sống
      resetSafetyTimer();

      // Khi SDK gửi event tiếp sau system init → MCP đã init xong
      // Tất cả pending → connected (nếu không failed thì đã connected)
      if (mcpInitPending && type !== 'system') {
        mcpInitPending = false;
        logger.info(`[Claude][${sessionId}] MCP init resolved — non-system event received`);
        emitter.emit('mcp:resolved', { sessionId });
      }

      switch (type) {
        case 'system': {
          // Xử lý các subtype khác nhau của system event
          const subtype = (sdkMsg as any).subtype as string;
          logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] System event: subtype=${subtype || 'init'}, session=${sdkMsg.session_id}, model=${sdkMsg.model}`);

          if (subtype === 'compact_boundary') {
            // SDK tự nén context — thông báo UI hiển thị marker
            const compactMeta = (sdkMsg as any).compact_metadata;
            logger.info(`[Claude][${sessionId}] Context compacted: ${compactMeta?.pre_tokens} → ${compactMeta?.post_tokens} tokens`);
            emitter.emit('compact:boundary', {
              sessionId,
              trigger: compactMeta?.trigger,
              preTokens: compactMeta?.pre_tokens,
              postTokens: compactMeta?.post_tokens,
            });
          } else if (subtype === 'task_started') {
            // Sub-agent bắt đầu — native event từ SDK, thay thế logic parse thủ công
            const taskId = (sdkMsg as any).task_id;
            const description = (sdkMsg as any).description;
            const taskType = (sdkMsg as any).task_type;
            logger.info(`[Claude][${sessionId}] Task started: ${taskId} (${taskType}) — ${description}`);
            emitter.emit('task:start', { sessionId, taskId, description, taskType });
          } else if (subtype === 'task_updated') {
            emitter.emit('task:update', { sessionId, taskId: (sdkMsg as any).task_id });
          } else {
            // System init và các subtype khác
            emitter.emit('system', { sessionId, data: sdkMsg });
            emitter.emit('status', { sessionId, status: 'thinking', startedAt: state.processingStartedAt });
          }

          // Extract MCP servers status từ BẤT KỲ system event nào có chứa mcp_servers
          // SDK có thể gửi lại status sau khi MCP đã connected/failed (không chỉ init)
          const mcpServers = (sdkMsg as any).mcp_servers;
          if (Array.isArray(mcpServers) && mcpServers.length > 0) {
            const statusSummary = mcpServers.map((s: any) => `${s.name}=${s.status}`).join(', ');
            logger.info(`[Claude][${sessionId}] MCP status (subtype=${(sdkMsg as any).subtype || 'init'}): ${statusSummary}`);

            // Chỉ emit khi có ít nhất 1 server KHÔNG pending — tránh UI hiện "pending" vô nghĩa
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

            // Nếu tất cả đều pending → set cờ chờ resolve khi event tiếp theo đến
            if (!hasResolvedStatus) {
              mcpInitPending = true;
            }
          }

          // Lấy model từ system event đầu tiên
          if (sdkMsg.model && !state.model) {
            state.model = sdkMsg.model;
            try { updateSession(sessionId, { model: state.model }); } catch { }
          }
          break;
        }

        // stream_event: nhận từ SDK khi includePartialMessages=true.
        // Chứa các delta mức độ hạt: content_block_start, content_block_delta, content_block_stop.
        // Dùng để live preview text/thinking/tool input trên UI tức thì.
        case 'stream_event': {
          const parentId = (sdkMsg as any).parent_tool_use_id || null;
          const rawEvent = (sdkMsg as any).event;
          if (!rawEvent) break;
          const evType = rawEvent.type as string;

          // Stream events CỦA sub-agent → forward riêng để UI hiện live activities
          if (parentId) {
            if (evType === 'content_block_start') {
              const cb = rawEvent.content_block;
              if (cb?.type === 'tool_use') {
                // Sub-agent bắt đầu gọi tool → emit activity mới ngay lập tức
                emitter.emit('subagent:activity', {
                  sessionId,
                  parentToolUseId: parentId,
                  type: 'tool_start',
                  toolName: cb.name || 'unknown',
                  toolId: cb.id || '',
                });
              }
            } else if (evType === 'content_block_delta') {
              const delta = rawEvent.delta;
              if (delta?.type === 'text_delta' && delta.text) {
                // Sub-agent đang viết text → emit để hiện preview
                emitter.emit('subagent:activity', {
                  sessionId,
                  parentToolUseId: parentId,
                  type: 'text_delta',
                  text: delta.text,
                });
              }
            }
            break;
          }

          // Đánh dấu đã nhận stream_event — handleAssistantEvent sẽ skip emit
          ctx.hasReceivedStreamEvents = true;

          if (evType === 'content_block_start') {
            const cb = rawEvent.content_block;
            if (!cb) break;
            const blockIndex = rawEvent.index ?? 0;

            if (cb.type === 'tool_use') {
              // Tool bắt đầu stream — thông báo frontend tạo card ngay
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
          } else if (evType === 'content_block_delta') {
            const delta = rawEvent.delta;
            if (!delta) break;

            if (delta.type === 'text_delta' && delta.text) {
              // Text delta — stream từng chữ tới frontend (live preview)
              emitter.emit('stream', {
                sessionId,
                content: delta.text,
                messageId: `msg-${sessionId}-streaming`,
              });
            } else if (delta.type === 'input_json_delta' && ctx.activeStreamBlock?.type === 'tool_use') {
              // Tích lũy JSON input và gửi từng phần cho frontend live preview
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
          } else if (evType === 'content_block_stop') {
            if (ctx.activeStreamBlock) {
              emitter.emit('stream:block_stop', {
                sessionId,
                blockIndex: ctx.activeStreamBlock.index,
                blockType: ctx.activeStreamBlock.type,
              });
              ctx.activeStreamBlock = null;
            }
          }
          // Các event khác (message_start, message_delta, message_stop) — bỏ qua
          break;
        }

        case 'assistant': {
          // parent_tool_use_id: SDK trả trường này trên message nằm trong context của sub-agent.
          // Dùng nó thay vì tự theo dõi activeTaskToolId.
          const parentToolUseId = (sdkMsg as any).parent_tool_use_id || null;
          // Reset activeStreamBlock khi nhận assistant event hoàn chỉnh —
          // assistant event chứa dữ liệu đầy đủ của các blocks, không cần theo dõi delta nữa
          ctx.activeStreamBlock = null;
          handleAssistantEvent(sdkMsg, sessionId, state, emitter, processor, ctx, parentToolUseId);
          break;
        }

        case 'user': {
          // SDK trả user event chứa tool_result — cần xử lý cho sub-agent
          const uParentId = (sdkMsg as any).parent_tool_use_id || null;
          const uMsg = (sdkMsg as any).message;
          if (uMsg?.content) {
            const blocks = Array.isArray(uMsg.content) ? uMsg.content : [uMsg.content];
            for (const b of blocks) {
              if (b.type === 'tool_result') processor.handleToolResult(b, ctx, uParentId);
            }
          }
          break;
        }

        case 'result': {
          // Nhận result → clear safety timer ngay
          if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
          logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] Final result event received`);
          handleResultEvent(sdkMsg, sessionId, state, emitter, ctx, queryInstance);
          break;
        }

        default: {
          // Xử lý các event type mới từ SDK (task_progress, prompt_suggestion, rate_limit)
          if (type === 'task_progress') {
            // Heartbeat mỗi ~30s từ sub-agent đang chạy (khi agentProgressSummaries = true)
            emitter.emit('task:progress', {
              sessionId,
              taskId: (sdkMsg as any).task_id,
              summary: (sdkMsg as any).summary,
            });
          } else if (type === 'prompt_suggestion') {
            // Gợi ý câu hỏi tiếp theo — hiển thị chip bên dưới input
            emitter.emit('prompt:suggestion', {
              sessionId,
              suggestion: (sdkMsg as any).suggestion,
            });
          } else if (type === 'rate_limit_event') {
            // Thông báo giới hạn rate limit
            logger.warn(`[Claude][${sessionId}] Rate limit event:`, (sdkMsg as any).rate_limit_info);
            emitter.emit('rate:limit', {
              sessionId,
              info: (sdkMsg as any).rate_limit_info,
            });
          } else {
            emitter.emit('raw', { sessionId, event: sdkMsg });
          }
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
    // Dọn dẹp safety timer bất kể thoát kiểu gì
    if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
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
 *
 * parentToolUseId: SDK trả trường này nếu message nằm trong context của sub-agent.
 * Dùng nó để phân biệt message chính vs message nội bộ sub-agent — thay vì
 * tự track activeTaskToolId thủ công.
 */
function handleAssistantEvent(
  sdkMsg: any,
  sessionId: string,
  state: ClaudeSessionState,
  emitter: EventEmitter,
  processor: QueryProcessor,
  ctx: any,
  parentToolUseId: string | null,
): void {
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
        emitter.emit('subagent:started', { sessionId, agentName, prompt: block.input?.description || '' });
      } else if (isInsideSubAgent) {
        // Tool call nội bộ của sub-agent — track activity + emit cho frontend live preview
        const activities = ctx.subAgentActivityMap.get(parentToolUseId) || [];
        activities.push({ name: tc.name, input: tc.input });
        ctx.subAgentActivityMap.set(parentToolUseId, activities);
        // Emit ngay để frontend cập nhật phần mở rộng Agent card
        // Extract thông tin chính từ input để hiển thị chi tiết
        const inputSummary = extractToolInputSummary(tc.name, tc.input);
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
        // Chỉ emit stream:tool khi CHƯA có stream_event (fallback)
        if (!skipEmit) {
          emitter.emit('stream:tool', { sessionId, tool: tc });
        }
        // Status luôn emit — cập nhật thanh trạng thái bất kể stream mode
        emitter.emit('status', { sessionId, status: 'tool_use', toolName: tc.name });
      }
    } else if (block.type === 'tool_result') {
      processor.handleToolResult(block, ctx, parentToolUseId);
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
    logger.info(`[Claude][${sessionId}] Finalized: ${ctx.turnBlocks.length} blocks, ${ctx.turnToolCalls.length} tools`);
  }

  // System messages cho error / completion
  // SDK tự phát error_max_turns và error_max_budget_usd khi vượt giới hạn
  if (result.is_error || result.subtype === 'error_max_turns' || result.subtype === 'error_max_budget_usd' || result.subtype === 'error_during_execution') {
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

/**
 * Trích xuất thông tin chính từ tool input để hiển thị ngắn gọn trên UI.
 * Ví dụ: Read → file path, Bash → command, Write → file path, etc.
 */
function extractToolInputSummary(toolName: string, input: Record<string, unknown>): string {
  const name = toolName.toLowerCase();
  if (name === 'read' || name === 'readfile') {
    const fp = String(input.file_path || input.path || input.filePath || '');
    return fp ? shortenPath(fp) : '';
  }
  if (name === 'write' || name === 'writefile' || name === 'create') {
    const fp = String(input.file_path || input.path || input.filePath || '');
    return fp ? shortenPath(fp) : '';
  }
  if (name === 'edit' || name === 'multiedit') {
    const fp = String(input.file_path || input.path || input.filePath || '');
    return fp ? shortenPath(fp) : '';
  }
  if (name === 'bash') {
    const cmd = String(input.command || input.cmd || '');
    return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
  }
  if (name === 'search' || name === 'grep' || name === 'globtool' || name === 'glob') {
    return String(input.pattern || input.query || input.glob || '').slice(0, 50);
  }
  if (name === 'listdir' || name === 'ls') {
    return String(input.path || input.dir || '').slice(0, 50);
  }
  // Fallback: trả key=value đầu tiên
  const entries = Object.entries(input);
  if (entries.length > 0) {
    const [k, v] = entries[0];
    const vs = String(v);
    return `${k}: ${vs.length > 40 ? vs.slice(0, 37) + '...' : vs}`;
  }
  return '';
}

/** Rút gọn đường dẫn file — chỉ hiện 2 phần cuối */
function shortenPath(fp: string): string {
  const parts = fp.split('/').filter(Boolean);
  if (parts.length <= 2) return fp;
  return '.../' + parts.slice(-2).join('/');
}
