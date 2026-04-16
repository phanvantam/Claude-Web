import path from 'path';
import { EventEmitter } from 'events';
import { updateSession } from '../session';
import { getMcpServersDetailed, buildSDKAgentDefinitions } from '../claude-meta';
import { logger } from '../logger';
import { ClaudeSessionState, SDKQueryConfig } from './types';
import * as utils from './utils';
import { QueryProcessor } from './processor';
import { persistMessage } from './messageHelpers';
import { handleAssistantEvent, handleResultEvent, TurnContext } from './sdkRunner/eventHandlers';

const LINUX_HIDDEN_COMPLETION_TOKEN = '__CLAUDE_SESSION_END__'; // TEMP: currently used cross-platform for testing
const ENABLE_CLAUDE_SESSION_END = ['1', 'true', 'yes', 'on'].includes(
  (process.env.ENABLE_CLAUDE_SESSION_END ?? 'true').trim().toLowerCase(),
);

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
  state.linuxCompletionTokenDetected = undefined;

  // ── Build SDK options (claude-agent-sdk format) ──
  const options: Record<string, any> = {
    cwd: config.cwd,
    // systemPrompt preset: bắt buộc để load CLAUDE.md
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    // Load settings từ project, user (~/.config/claude/), local
    settingSources: ['project', 'user', 'local'],
  };

  const isAbortRequested = (): boolean => {
    return !!state.abortRequestedAt || state.interruptReason === 'user_abort';
  };

  const shouldIgnoreEventAfterInterrupt = (eventType: string): boolean => {
    if (!state.isProcessing) return false;

    // User bấm Stop: chỉ giữ lại result để cleanup, bỏ qua mọi event khác.
    if (state.interruptReason === 'user_abort' || !!state.abortRequestedAt) {
      return eventType !== 'result';
    }

    // Linux completion token: KHÔNG bỏ qua event nào.
    // Mục tiêu token chỉ để xử lý case treo không ra result, không làm mất metadata/event.
    if (state.interruptReason === 'linux_completion_token') {
      return false;
    }

    return false;
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
  // Phân loại tool theo mức rủi ro, kết hợp với permissionMode để quyết định
  // cho phép / hỏi / chặn. AskUserQuestion luôn hiển thị UI bất kể mode.
  options.permissionMode = config.permissionMode || 'default';

  /**
   * Phân loại mức độ rủi ro của tool.
   * - LOW:    chỉ đọc dữ liệu, an toàn tuyệt đối
   * - MEDIUM: ghi/sửa/xóa file — ảnh hưởng codebase nhưng có thể revert
   * - HIGH:   thực thi lệnh hệ thống hoặc tool bên ngoài (MCP) — không thể kiểm soát
   */
  type ToolRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
  const getToolRiskLevel = (tool: string): ToolRiskLevel => {
    // LOW: Tool chỉ đọc — an toàn cho mọi mode
    if (/^(Read|View|Cat|LS|List|Search|Grep|Glob|Find|Notebook|ExitPlan)/i.test(tool)
      || tool === 'ListCodeDefinitionNames'
      || tool === 'ListNotebooks') {
      return 'LOW';
    }
    // MEDIUM: Tool ghi/sửa file
    if (/^(Write|Edit|MultiEdit|Move|Rename|Delete|Mkdir|Append|Create)/i.test(tool)) {
      return 'MEDIUM';
    }
    // HIGH: Bash, MCP tools, và mọi tool không xác định
    return 'HIGH';
  };

  options.canUseTool = async (
    toolName: string,
    input: Record<string, unknown>,
    { signal }: { signal: AbortSignal },
  ) => {
    if (isAbortRequested()) {
      logger.info(`[Claude][${sessionId}] canUseTool denied because abort was requested`);
      return { behavior: 'deny' as const, message: 'Đã hủy theo yêu cầu người dùng.' };
    }

    const riskLevel = getToolRiskLevel(toolName);
    logger.info(`[Claude][${sessionId}] canUseTool: ${toolName} (risk=${riskLevel}, mode=${options.permissionMode})`);
    state.activeToolName = toolName;
    emitter.emit('status', { sessionId, status: 'tool_use', toolName });

    // ── AskUserQuestion — LUÔN chờ user trả lời, bất kể permission mode ──
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

    // ── Plan mode: cho phép đọc, chặn ghi/thực thi (trừ file plan) ──
    if (options.permissionMode === 'plan') {
      if (riskLevel === 'LOW') {
        return { behavior: 'allow' as const, updatedInput: input };
      }
      // Ngoại lệ: cho phép ghi file vào thư mục plans của PROJECT (không phải global ~/.claude/plans/)
      const rawFilePath = typeof (input as any).file_path === 'string' ? String((input as any).file_path).trim() : '';
      const projectPlansDir = `${config.cwd}/.claude/plans/`;
      const normalizedProjectPlansDir = projectPlansDir.replace(/\/+/g, '/');
      const normalizePath = (v: string) => v.replace(/\\/g, '/');
      const isWriteTool = /^(Edit|Write|MultiEdit|Create)/i.test(toolName);

      if (isWriteTool) {
        if (!rawFilePath) {
          return {
            behavior: 'deny' as const,
            message: `Chế độ lập kế hoạch: tool ${toolName} bắt buộc có file_path trong ${projectPlansDir}`,
          };
        }

        const normalizedRawPath = normalizePath(rawFilePath);
        const isGlobalPlansPath = normalizedRawPath.includes('/.claude/plans/') && !normalizedRawPath.startsWith(normalizedProjectPlansDir);
        if (isGlobalPlansPath || normalizedRawPath.startsWith('~/.claude/plans/')) {
          logger.warn(`[Claude][${sessionId}] Plan mode: chặn ghi vào global plans path ${rawFilePath}`);
          return {
            behavior: 'deny' as const,
            message: `Chế độ lập kế hoạch: chỉ được ghi vào ${projectPlansDir}, không được dùng ~/.claude/plans/.`,
          };
        }

        let resolvedPath = rawFilePath;
        if (!path.isAbsolute(resolvedPath)) {
          resolvedPath = path.resolve(config.cwd, resolvedPath);
        }
        const normalizedResolvedPath = normalizePath(path.resolve(resolvedPath));

        if (!normalizedResolvedPath.startsWith(normalizedProjectPlansDir)) {
          logger.warn(`[Claude][${sessionId}] Plan mode: chặn ghi ngoài project plans dir ${resolvedPath}`);
          return {
            behavior: 'deny' as const,
            message: `Chế độ lập kế hoạch: chỉ được ghi kế hoạch trong ${projectPlansDir}`,
          };
        }

        (input as any).file_path = resolvedPath;
        logger.info(`[Claude][${sessionId}] Plan mode: cho phép ghi plan file ${resolvedPath}`);
        return { behavior: 'allow' as const, updatedInput: input };
      }
      logger.info(`[Claude][${sessionId}] Plan mode: chặn tool ${toolName}`);
      return {
        behavior: 'deny' as const,
        message: `Chế độ lập kế hoạch: chỉ được phân tích, đọc code và ghi kế hoạch vào ${projectPlansDir}. Không được sửa file source hay chạy lệnh.`,
      };
    }

    // ── bypassPermissions: cho phép mọi thứ ──
    if (options.permissionMode === 'bypassPermissions') {
      return { behavior: 'allow' as const, updatedInput: input };
    }

    // ── acceptEdits / auto: cho phép LOW + MEDIUM, hỏi HIGH ──
    if (options.permissionMode === 'acceptEdits' || options.permissionMode === 'auto') {
      if (riskLevel === 'LOW' || riskLevel === 'MEDIUM') {
        return { behavior: 'allow' as const, updatedInput: input };
      }
      // HIGH risk → rơi xuống logic hỏi user bên dưới
      logger.info(`[Claude][${sessionId}] ${options.permissionMode} mode: tool ${toolName} là HIGH risk, hỏi user`);
    }

    // ── default + HIGH risk từ acceptEdits/auto → hỏi user xác nhận qua WebSocket ──
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
  // Nối thêm (append) chỉ thị bổ sung dựa theo context.
  const appendParts: string[] = [];

  // Chỉ thị cho plan mode — ép Claude ghi kế hoạch vào đúng thư mục PROJECT (absolute path)
  // QUAN TRỌNG: dùng absolute path để tránh CLI resolve sang ~/.claude/plans/ (global)
  if (config.permissionMode === 'plan') {
    const projectPlansDir = `${config.cwd}/.claude/plans`;
    appendParts.push(
      `[PLAN MODE INSTRUCTIONS]`,
      `Bạn đang ở chế độ lập kế hoạch. Các quy tắc bắt buộc:`,
      `1. Phân tích codebase bằng các công cụ đọc (Read, Glob, Grep, List).`,
      `2. Viết kế hoạch chi tiết dưới dạng Markdown.`,
      `3. PHẢI lưu file kế hoạch vào thư mục: ${projectPlansDir}/`,
      `   TUYỆT ĐỐI KHÔNG lưu vào ~/.claude/plans/ hay bất kỳ thư mục global nào.`,
      `4. Tên file phải mô tả nội dung, ví dụ: refactor-auth-module.md, fix-payment-bug.md`,
      `5. KHÔNG được sửa bất kỳ file source code nào. Chỉ được TẠO/GHI file trong ${projectPlansDir}/`,
      `6. Kế hoạch phải bao gồm: Mục tiêu, Phân tích hiện trạng, Các bước thực hiện, và Rủi ro.`,
    );
  }

  // Nối config.systemPrompt nếu có
  if (config.systemPrompt) {
    appendParts.push(config.systemPrompt);
  }

  if (appendParts.length > 0) {
    options.systemPrompt = {
      type: 'preset',
      preset: 'claude_code',
      append: appendParts.join('\n'),
    };
  }

  const completionTokenUserInstruction = [
    '[SESSION END KEY REQUIREMENT]',
    `When you have fully completed your final answer, you MUST print this exact key at the VERY END of your response: ${LINUX_HIDDEN_COMPLETION_TOKEN}`,
    'Do not wrap this key in backticks/markdown, and do not output any characters after the key.',
  ].join('\n');
  const effectivePrompt = ENABLE_CLAUDE_SESSION_END
    ? `${message}\n\n${completionTokenUserInstruction}`
    : message;

  logger.info(`[sdkRunner] SDK Session Options: sessionId=${sessionId}, model=${options.model}, systemPromptAppendLength=${(options.systemPrompt as any).append?.length || 0}`);
  logger.debug(`[sdkRunner] completionTokenInstructionInUserPrompt=${ENABLE_CLAUDE_SESSION_END}`);
  if ((options.systemPrompt as any).append) {
    logger.debug(`[sdkRunner] System Prompt Append: ${(options.systemPrompt as any).append}`);
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
  // Giữ nguyên 300s theo yêu cầu để tránh watchdog cắt quá sớm với phiên dài.
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

  // ── Dynamic Watchdog: Timeout thích ứng theo ngữ cảnh ──
  // Thay vì dùng 1 con số timeout cứng, watchdog phân biệt 2 trạng thái:
  //   1. Model đang sinh text/thinking (không có tool chạy): timeout STREAM_IDLE_TIMEOUT_MS (5 phút)
  //      → Tránh cắt nhầm các phiên không phát stream liên tục.
  //   2. Tool đang thực thi (Bash, Read file lớn...): timeout DÀI (10 phút)
  //      → Tôn trọng thời gian chạy hợp lệ.
  //   3. Pending permission / Sub-agent: bỏ qua timer, chờ user phản hồi.
  let safetyTimer: ReturnType<typeof setTimeout> | null = null;
  let linuxCompletionInterruptTimer: ReturnType<typeof setTimeout> | null = null;
  let queryInstance: any = null;
  const STREAM_IDLE_TIMEOUT_MS = 300_000;    // 300 giây (5 phút) — model im lặng = treo
  const TOOL_EXEC_TIMEOUT_MS = 600_000;      // 10 phút — tool chạy lâu hợp lệ
  const LINUX_COMPLETION_INTERRUPT_DELAY_MS = 2000;

  const resetSafetyTimer = () => {
    if (safetyTimer) clearTimeout(safetyTimer);

    // Xác định timeout phù hợp dựa trên trạng thái hiện tại
    const isToolRunning = !!state.activeToolName;
    const isSubAgentRunning = !!state.activeSubAgent;
    const isPendingPermission = !!state.pendingPermission;

    // Khi đang chờ permission hoặc sub-agent → dùng timeout dài
    // Khi tool đang chạy → dùng timeout dài (tool Bash có thể mất vài phút)
    // Khi model đang nói/nghĩ → dùng STREAM_IDLE_TIMEOUT_MS
    const timeoutMs = (isPendingPermission || isToolRunning || isSubAgentRunning)
      ? TOOL_EXEC_TIMEOUT_MS
      : STREAM_IDLE_TIMEOUT_MS;

    safetyTimer = setTimeout(async () => {
      // Double-check: tại thời điểm timeout fire, có thể trạng thái đã thay đổi
      if (state.pendingPermission) {
        logger.debug(`[Claude][${sessionId}] Watchdog skipped — pending permission`);
        resetSafetyTimer();
        return;
      }

      const reason = isToolRunning
        ? `Tool '${state.activeToolName}' chạy quá ${TOOL_EXEC_TIMEOUT_MS / 1000}s`
        : `Không nhận được dữ liệu sau ${STREAM_IDLE_TIMEOUT_MS / 1000}s (SSE Stall?)`;
      logger.warn(`[Claude][${sessionId}] Dynamic Watchdog triggered: ${reason}`);

      state.interruptReason = 'watchdog_timeout';

      try {
        if (queryInstance) await queryInstance.interrupt();
      } catch (e: any) {
        if (e?.message?.includes('Query closed') || e?.message?.includes('ProcessTransport')) {
          logger.debug(`[Claude][${sessionId}] Expected error after interrupt, ignoring`);
        } else {
          logger.warn(`[Claude][${sessionId}] interrupt() failed:`, e);
        }
      }
    }, timeoutMs);
  };
  resetSafetyTimer();

  // ── Turn context — tích lũy blocks từ TẤT CẢ assistant events thành 1 message ──
  const processor = new QueryProcessor(sessionId, state, emitter);
  const ctx: TurnContext = {
    turnBlocks: [],
    turnToolCalls: [],
    turnTextParts: [],
    streamedMainTextChunks: [],
    turnMsgId: `turn-${Date.now()}`,
    turnModel: undefined,
    turnTokensTotal: { input: 0, output: 0 },
    turnStartedAt: Date.now(),
    // Map: parentToolUseId → danh sách activities nội bộ của sub-agent đó.
    // Dùng parent_tool_use_id từ SDK message thay vì manual tracking.
    subAgentActivityMap: new Map(),
    // Map: tool_use_id → agent name (để tra cứu khi kết thúc)
    subAgentNames: new Map(),
    // Stream state: theo dõi các block đang được stream (live preview)
    // Key = blockIndex, Value = thông tin block đang tích lũy
    activeStreamBlock: null,
    // Flag: đã nhận stream_event (includePartialMessages=true đang hoạt động).
    // Khi true → handleAssistantEvent sẽ KHÔNG emit stream events nữa (tránh duplicate)
    // vì stream_event đã gửi delta tới frontend rồi.
    hasReceivedStreamEvents: false,
  };

  const startTime = Date.now();
  const getElapsed = () => `${Date.now() - startTime}ms`;

  const syncPartialTurnToState = () => {
    state.partialAssistantBlocks = [...ctx.turnBlocks];
    state.partialToolCalls = [...ctx.turnToolCalls];
    state.partialAssistantContent = ctx.turnTextParts.join('');
  };

  const clearPartialTurnInState = () => {
    state.partialAssistantBlocks = undefined;
    state.partialToolCalls = undefined;
    state.partialAssistantContent = undefined;
  };

  const normalizedCompletionToken = LINUX_HIDDEN_COMPLETION_TOKEN.toUpperCase();
  let streamCompletionTokenTail = '';

  const hasLinuxCompletionToken = (text: string): boolean => {
    if (!ENABLE_CLAUDE_SESSION_END) return false;
    return text.toUpperCase().includes(normalizedCompletionToken);
  };

  const hasLinuxCompletionTokenAcrossStreamChunks = (chunk: string): boolean => {
    if (!ENABLE_CLAUDE_SESSION_END || !chunk) return false;
    const merged = `${streamCompletionTokenTail}${chunk}`.toUpperCase();
    const found = merged.includes(normalizedCompletionToken);
    const tailLength = Math.max(normalizedCompletionToken.length - 1, 0);
    streamCompletionTokenTail = tailLength > 0 ? merged.slice(-tailLength) : '';
    return found;
  };

  const interruptForLinuxCompletion = (source: 'stream_event' | 'assistant') => {
    if (!queryInstance || state.linuxCompletionTokenDetected) return;
    state.linuxCompletionTokenDetected = true;
    state.interruptReason = 'linux_completion_token';

    if (linuxCompletionInterruptTimer) {
      clearTimeout(linuxCompletionInterruptTimer);
    }

    logger.info(
      `[Claude][${sessionId}] Linux completion token detected from ${source}, schedule interrupt in ${LINUX_COMPLETION_INTERRUPT_DELAY_MS}ms`,
    );

    linuxCompletionInterruptTimer = setTimeout(async () => {
      if (!queryInstance || !state.isProcessing) {
        linuxCompletionInterruptTimer = null;
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
        linuxCompletionInterruptTimer = null;
      }
    }, LINUX_COMPLETION_INTERRUPT_DELAY_MS);
  };

  try {
    const claudeBinary = utils.getClaudeBinary();
    logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] Starting sdk.query (string prompt)...`);
    logger.info(`[Claude][${sessionId}] Binary: ${claudeBinary}, permissionMode: ${options.permissionMode}, promptLength: ${effectivePrompt.length}`);

    // claude-agent-sdk: dùng string prompt trực tiếp, SDK tự đóng stdin → không treo pipe
    queryInstance = sdk.query({
      prompt: effectivePrompt,
      options,
      // Đưa pathToClaudeCodeExecutable ra ngoài cấp root của object cấu hình
      pathToClaudeCodeExecutable: claudeBinary
    });

    // Lưu query instance vào state — abortSession sẽ gọi interrupt() để kill CLI process
    state.queryInstance = queryInstance;

    // Xử lý race: user bấm Stop trước khi queryInstance được gán.
    if (isAbortRequested()) {
      logger.info(`[Claude][${sessionId}] Abort was requested before loop start, interrupt immediately`);
      try {
        await queryInstance.interrupt();
      } catch (err: any) {
        if (err?.message?.includes('Query closed') || err?.message?.includes('ProcessTransport')) {
          logger.debug(`[Claude][${sessionId}] Expected close error after early interrupt`);
        } else {
          logger.warn(`[Claude][${sessionId}] Early interrupt failed:`, err);
        }
      }
    }

    logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] sdk.query initiated, starting for-await loop`);

    let eventCount = 0;
    // Cờ: system init đã gửi MCP status = pending → cần resolve khi event tiếp theo đến
    let mcpInitPending = false;

    for await (const sdkMsg of queryInstance) {
      eventCount++;
      const type = sdkMsg.type as string;
      logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] SDK Event #${eventCount}: ${type}`);

      // Sau khi interrupt, lọc event theo ngữ cảnh để vừa dừng nhanh vừa không mất dữ liệu.
      if (shouldIgnoreEventAfterInterrupt(type)) {
        logger.debug(`[Claude][${sessionId}] Ignore ${type} after interrupt reason=${state.interruptReason}`);
        continue;
      }

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
            state.activeToolName = undefined;
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
                if (state.activeSubAgent) {
                  state.activeSubAgent = {
                    ...state.activeSubAgent,
                    currentToolName: cb.name || 'unknown',
                    lastHeartbeat: Date.now(),
                  };
                }
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
                if (state.activeSubAgent) {
                  state.activeSubAgent = {
                    ...state.activeSubAgent,
                    lastHeartbeat: Date.now(),
                  };
                }
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
              const streamText = delta.text;
              if (hasLinuxCompletionTokenAcrossStreamChunks(streamText) || hasLinuxCompletionToken(streamText)) {
                interruptForLinuxCompletion('stream_event');
              }
              // Text delta — stream từng chữ tới frontend (live preview)
              if (streamText) {
                ctx.streamedMainTextChunks.push(streamText);
                emitter.emit('stream', {
                  sessionId,
                  content: streamText,
                  messageId: `msg-${sessionId}-streaming`,
                });
              }
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
                toolName: ctx.activeStreamBlock.type === 'tool_use' ? ctx.activeStreamBlock.toolName : undefined,
                streamingInput: ctx.activeStreamBlock.type === 'tool_use' ? ctx.activeStreamBlock.accumulatedInput : undefined,
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
          if (!parentToolUseId) {
            const apiMsg = (sdkMsg as any).message;
            if (apiMsg?.content && Array.isArray(apiMsg.content)) {
              for (const block of apiMsg.content) {
                if (block.type === 'text' && typeof block.text === 'string' && hasLinuxCompletionToken(block.text)) {
                  interruptForLinuxCompletion('assistant');
                }
              }
            }
          }
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
            // Emit stream:blocks sau khi tool_result xử lý — giúp frontend
            // cập nhật trạng thái tool card tức thì (loading → hoàn thành).
            // Trước đây chỉ assistant event mới emit → tool status bị delay.
            if (!uParentId) {
              syncPartialTurnToState();
              emitter.emit('stream:blocks', {
                sessionId,
                blocks: ctx.turnBlocks,
              });
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
            if (state.activeSubAgent) {
              state.activeSubAgent = {
                ...state.activeSubAgent,
                lastHeartbeat: Date.now(),
              };
              syncPartialTurnToState();
            }
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
    const errMsg = err.message || String(err);
    const isAbortError = err.name === 'AbortError' || abortController.signal.aborted || errMsg.includes('Request was aborted');
    const isEdeDiagnostic = errMsg.includes('[ede_diagnostic]') && (errMsg.includes('stop_reason=tool_use') || errMsg.includes('stop_reason=null'));

    if (isAbortError) {
      logger.info(`[Claude] Query aborted for ${sessionId}`);
    } else if (isEdeDiagnostic) {
      // SDK diagnostic error sau khi đã xử lý result — bỏ qua an toàn
      logger.warn(`[Claude][${sessionId}] SDK ede_diagnostic after result handling — expected, ignoring`);
    } else {
      throw err;
    }
  } finally {
    // Restore env sau khi query đã kết thúc hoàn toàn để binary claude luôn nhận đúng timeout.
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Dọn dẹp safety timer bất kể thoát kiểu gì
    if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null; }
    if (linuxCompletionInterruptTimer) {
      clearTimeout(linuxCompletionInterruptTimer);
      linuxCompletionInterruptTimer = null;
    }
    clearInterval(saveInterval);
    state.abortController = undefined;
    state.queryInstance = undefined;
    state.pendingPermission = undefined;
    clearPartialTurnInState();
    if (state.isProcessing) {
      logger.warn(`[Claude][${sessionId}] finally: isProcessing still true — forcing idle`);
      state.isProcessing = false;
      state.activeToolName = undefined;
      state.activeSubAgent = undefined;
      clearPartialTurnInState();
      emitter.emit('status', { sessionId, status: 'idle' });

      const forcedResultContent = state.interruptReason === 'user_abort'
        ? 'Đã dừng theo thao tác bấm Dừng của người dùng.'
        : state.interruptReason === 'watchdog_timeout'
          ? 'Đã dừng do hết thời gian chờ (timeout) vì không còn dữ liệu mới.'
          : state.interruptReason === 'linux_completion_token'
            ? 'Hoàn thành do model gửi key kết thúc phiên.'
            : 'Hoàn thành.';

      const forcedResultMsg = {
        id: `result-${Date.now()}`,
        role: 'system' as const,
        content: forcedResultContent,
        timestamp: new Date().toISOString(),
      };
      state.messages.push(forcedResultMsg);
      persistMessage(sessionId, forcedResultMsg);
      emitter.emit('result', { sessionId, result: forcedResultMsg, data: { source: 'sdkRunner:finally' } });
    }

    state.linuxCompletionTokenDetected = undefined;
    state.abortRequestedAt = undefined;
    state.interruptReason = undefined;
  }
}

// Event handlers đã được tách sang ./sdkRunner/eventHandlers.ts
// Helper functions đã được tách sang ./sdkRunner/helpers.ts
