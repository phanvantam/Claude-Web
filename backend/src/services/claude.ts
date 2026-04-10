import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import fs from 'fs';
import type { ChatMessage, ToolCall, ContentBlock } from '../types';
import { getConfig } from './config';
import { getProject } from './project';
import { getSession, createSession, addMessage, updateMessageMeta, updateSession } from './session';
import { getMcpServersDetailed } from './claude-meta';
import { logger } from './logger';

/**
 * Resolve đường dẫn tuyệt đối của Claude CLI executable.
 * SDK cần biết đường dẫn tới binary claude để spawn nó bên dưới.
 */
function resolveClaudeBinary(): string {
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      logger.info(`[ClaudeService] Found Claude CLI at: ${candidate}`);
      return candidate;
    }
  }

  logger.warn('[ClaudeService] Claude CLI not found at known paths, falling back to "claude"');
  return 'claude';
}

/** Đường dẫn tuyệt đối của Claude CLI — resolve 1 lần khi module load */
const CLAUDE_BIN = resolveClaudeBinary();

// ─── SDK Types ───────────────────────────────────────────────────────────────
// SDK là ESM, cần dynamic import(). Cache lại module sau lần load đầu.
let sdkModule: any = null;

/** Lazy-load @anthropic-ai/claude-code SDK (ESM package trong CJS context) */
async function getSDK(): Promise<any> {
  if (!sdkModule) {
    sdkModule = await import('@anthropic-ai/claude-code');
  }
  return sdkModule;
}

// ─── Session State ───────────────────────────────────────────────────────────

interface ClaudeSessionState {
  sessionId: string;
  projectId: string;
  isProcessing: boolean;
  /** Timestamp (ms) khi bắt đầu processing — dùng cho elapsed timer */
  processingStartedAt?: number;
  messages: ChatMessage[];
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  /** Tên phiên (tin nhắn user đầu tiên) — lưu 1 lần duy nhất */
  sessionName?: string;
  /** AbortController cho query hiện tại — dùng để cancel */
  abortController?: AbortController;
  /** Pending permission request đang chờ user xác nhận */
  pendingPermission?: {
    toolName: string;
    input: Record<string, unknown>;
    resolve: (result: any) => void;
  };
}

class ClaudeService extends EventEmitter {
  private sessions: Map<string, ClaudeSessionState> = new Map();

  getSessionState(sessionId: string): { messages: ChatMessage[]; isProcessing: boolean; processingStartedAt?: number; model?: string; effortLevel?: string; permissionMode?: string; pendingPermission?: any } | null {
    const state = this.sessions.get(sessionId);
    if (state) {
      return {
        messages: state.messages,
        isProcessing: state.isProcessing,
        processingStartedAt: state.processingStartedAt,
        model: state.model,
        effortLevel: state.effortLevel,
        permissionMode: state.permissionMode,
        pendingPermission: state.pendingPermission ? {
          toolName: state.pendingPermission.toolName,
          input: state.pendingPermission.input
        } : undefined,
      };
    }

    // Fallback: load từ DB
    const saved = getSession(sessionId);
    if (saved) {
      return {
        messages: saved.messages,
        isProcessing: false,
        model: saved.model,
        effortLevel: saved.effortLevel,
        permissionMode: saved.permissionMode,
      };
    }
    return null;
  }

  /**
   * Cập nhật effort level cho một session đang active hoặc đã lưu.
   */
  setSessionEffortLevel(sessionId: string, effortLevel?: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.effortLevel = effortLevel;
    }
    updateSession(sessionId, { effortLevel });
  }

  /**
   * Lấy effort level hiện tại của session.
   */
  getSessionEffortLevel(sessionId: string): string | undefined {
    const state = this.sessions.get(sessionId);
    if (state) return state.effortLevel;
    const saved = getSession(sessionId);
    return saved?.effortLevel;
  }

  /**
   * Cập nhật permission mode cho một session đang active hoặc đã lưu.
   */
  setSessionPermissionMode(sessionId: string, permissionMode?: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.permissionMode = permissionMode;
    }
    updateSession(sessionId, { permissionMode });
  }

  /**
   * Lấy permission mode hiện tại của session.
   */
  getSessionPermissionMode(sessionId: string): string | undefined {
    const state = this.sessions.get(sessionId);
    if (state) return state.permissionMode;
    const saved = getSession(sessionId);
    return saved?.permissionMode;
  }

  /**
   * Kiểm tra xem Claude CLI có file conversation cho session này không.
   * CLI lưu tại: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
   * Đường dẫn cwd được encode: '/' → '-', bỏ trailing slash.
   */
  private hasCliSession(sessionId: string, cwd: string): boolean {
    try {
      // Claude CLI encode cwd: thay tất cả ký tự không phải alphanumeric/dash thành '-'
      // Ví dụ: /Users/tampv/Projects/tampv.com → -Users-tampv-Projects-tampv-com
      const encodedCwd = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
      const claudeDir = path.join(os.homedir(), '.claude', 'projects', encodedCwd);
      const sessionFile = path.join(claudeDir, `${sessionId}.jsonl`);
      const exists = fs.existsSync(sessionFile);
      logger.debug(`[ClaudeService] hasCliSession: ${sessionFile} → ${exists}`);
      return exists;
    } catch (err) {
      logger.warn(`[ClaudeService] hasCliSession check failed:`, err);
      return false;
    }
  }

  /**
   * Thêm 1 message vào CSDL.
   */
  private persistMessage(sessionId: string, msg: ChatMessage) {
    try {
      addMessage(sessionId, msg);
    } catch (err) {
      logger.error(`[ClaudeService] Lỗi khi lưu message ${msg.id}:`, err);
    }
  }

  /**
   * Khởi tạo hoặc attach vào một session.
   * Nếu session đã có trong memory → trả lại luôn.
   * Nếu có trong DB → load messages.
   * Nếu chưa có → tạo mới trong DB.
   */
  async startSession(projectId: string, existingSessionId?: string, effortLevel?: string): Promise<string> {
    const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const sessionId = (existingSessionId && isUuid(existingSessionId))
      ? existingSessionId
      : uuidv4();

    logger.info(`[ClaudeService] Using sessionId=${sessionId}`);
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // Session đã có trong memory → trả về luôn
    if (this.sessions.has(sessionId)) {
      logger.info(`[ClaudeService] Session ${sessionId} found in memory`);
      return sessionId;
    }

    const savedSession = getSession(sessionId);
    if (savedSession) {
      logger.info(`[ClaudeService] Session ${sessionId} loaded from disk with ${savedSession.messages.length} messages`);
    } else {
      logger.info(`[ClaudeService] Session ${sessionId} not found on disk, creating new`);
    }

    const state: ClaudeSessionState = {
      sessionId,
      projectId,
      isProcessing: false,
      messages: savedSession ? savedSession.messages : [],
      model: savedSession?.model,
      effortLevel: savedSession?.effortLevel ?? effortLevel,
      permissionMode: savedSession?.permissionMode,
      sessionName: savedSession?.name,
    };

    if (!savedSession) {
      createSession({
        id: sessionId,
        projectId,
        sessionId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true,
        effortLevel: effortLevel,
      });
    }

    // Nếu client truyền effortLevel mới → ghi đè
    if (effortLevel !== undefined && state.effortLevel !== effortLevel) {
      state.effortLevel = effortLevel;
      try {
        updateSession(sessionId, { effortLevel });
      } catch (e) {
        logger.warn(`[ClaudeService] Failed to persist session effortLevel:`, e);
      }
    }

    // Cập nhật activeSessionId cho project
    if (project.activeSessionId !== sessionId) {
      try {
        const projectService = require('./project');
        projectService.updateProject(projectId, { activeSessionId: sessionId });
        logger.info(`[ClaudeService] Updated project ${projectId} activeSessionId to ${sessionId}`);
      } catch (err) {
        logger.error('[ClaudeService] Failed to update project activeSessionId:', err);
      }
    }

    this.sessions.set(sessionId, state);
    return sessionId;
  }

  /**
   * Gửi message tới Claude SDK.
   * SDK tự spawn CLI process, xử lý stdin/stdout, và trả về AsyncGenerator<SDKMessage>.
   */
  sendMessage(sessionId: string, message: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      throw new Error(`No active session: ${sessionId}`);
    }
    if (state.isProcessing) {
      throw new Error(`Session ${sessionId} is already processing`);
    }

    state.isProcessing = true;
    state.processingStartedAt = Date.now();
    // Emit 'initializing' thay vì 'thinking' — frontend hiển "Khởi tạo MCP..." trong giai đoạn CLI startup
    this.emit('status', { sessionId, status: 'initializing', startedAt: state.processingStartedAt });

    // Lưu user message vào state + DB
    const chatMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    state.messages.push(chatMsg);
    this.persistMessage(sessionId, chatMsg);

    // Lưu tên phiên = tin nhắn user đầu tiên (chỉ chạy 1 lần)
    if (!state.sessionName) {
      const shortName = message.length > 80 ? message.slice(0, 80) + '...' : message;
      state.sessionName = shortName;
      try { updateSession(sessionId, { name: shortName }); } catch {}
    }

    const project = getProject(state.projectId);
    const config = getConfig();

    // Merge config: session-level ưu tiên hơn global
    const effectiveModel = state.model || config.model;
    const effectiveEffort = state.effortLevel || (config as any).effortLevel;
    const effectivePermission = state.permissionMode || config.permissionMode;

    // Chốt model cho session nếu chưa có
    if (!state.model && effectiveModel) {
      state.model = effectiveModel;
      try { updateSession(sessionId, { model: state.model }); } catch {}
    }

    // Chốt effortLevel cho session nếu chưa có
    if (!state.effortLevel && effectiveEffort) {
      state.effortLevel = effectiveEffort;
      try { updateSession(sessionId, { effortLevel: state.effortLevel }); } catch {}
    }

    // Chạy SDK query async — không block
    this.runSDKQuery(sessionId, message, {
      cwd: project!.path,
      model: effectiveModel,
      effortLevel: effectiveEffort,
      permissionMode: effectivePermission,
      systemPrompt: config.systemPrompt,
      maxBudgetUsd: config.maxBudgetUsd,
      customArgs: config.customArgs,
    }).catch((err) => {
      logger.error(`[ClaudeService] SDK query error for ${sessionId}:`, err);
      this.emit('error', { sessionId, error: err.message || String(err) });
      state.isProcessing = false;
      this.emit('status', { sessionId, status: 'idle' });
    });
  }

  /**
   * Chạy SDK query() và xử lý stream messages.
   * Đây là core logic — thay thế toàn bộ spawnClaudeProcess + handleOutput + processStreamEvent cũ.
   */
  private async runSDKQuery(
    sessionId: string,
    message: string,
    config: {
      cwd: string;
      model?: string;
      effortLevel?: string;
      permissionMode?: string;
      systemPrompt?: string;
      maxBudgetUsd?: number;
      customArgs?: string[];
    },
  ): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const sdk = await getSDK();

    // Quyết định resume hay session mới dựa trên file .jsonl thực tế trong Claude CLI storage.
    // App DB (database.sqlite) và CLI storage (~/.claude/projects/) là 2 hệ thống tách biệt.
    // Chỉ resume khi CLI thực sự có conversation file — tránh lỗi "No conversation found".
    const isResume = this.hasCliSession(sessionId, config.cwd);

    logger.info(`[Claude] Session ${sessionId}: cliSessionExists=${isResume}, strategy=${isResume ? 'resume' : 'new'}`);

    const abortController = new AbortController();
    state.abortController = abortController;

    // Build SDK options
    const options: Record<string, any> = {
      abortController,
      cwd: config.cwd,
      pathToClaudeCodeExecutable: CLAUDE_BIN,
    };

    // Truyền MCP servers vào SDK — CLI trong SDK mode không chắc đọc đúng
    // project-specific MCP từ ~/.claude.json → projects[cwd].mcpServers.
    // Merge global + project để đảm bảo tất cả MCP tools khả dụng.
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

    if (isResume) {
      options.resume = sessionId;
    }

    if (config.model) {
      options.model = config.model;
    }

    // Xác định permission mode — nếu user chọn 'default', sử dụng canUseTool callback
    // để hiện popup xác nhận trên frontend. Các mode khác (acceptEdits, bypassPermissions, plan)
    // SDK tự xử lý mà không cần hỏi user.
    const useInteractivePermission = !config.permissionMode || config.permissionMode === 'default';

    if (useInteractivePermission) {
      // Mode 'default': gắn canUseTool callback để hỏi user qua WebSocket
      options.permissionMode = 'default';
      options.canUseTool = async (
        toolName: string,
        input: Record<string, unknown>,
        { signal }: { signal: AbortSignal },
      ) => {
        logger.info(`[Claude][${sessionId}] canUseTool called for: ${toolName}`);

        // Emit status tool_use kèm tên tool — frontend hiện tên cụ thể thay vì "Công cụ..."
        this.emit('status', { sessionId, status: 'tool_use', toolName });

        // Tạo Promise chờ user phản hồi từ frontend
        return new Promise<any>((resolve, reject) => {
          // Nếu đã abort → từ chối ngay
          if (signal.aborted) {
            return resolve({ behavior: 'deny', message: 'Đã hủy.' });
          }

          // Lưu pending permission vào state để resolvePermission() có thể gọi resolve()
          state.pendingPermission = { toolName, input, resolve };

          // Emit event tới frontend qua EventEmitter → socket.io sẽ forward
          this.emit('permission:request', { sessionId, toolName, input });

          // Nếu abort signal kích hoạt trong lúc chờ → tự resolve deny
          const onAbort = () => {
            if (state.pendingPermission?.resolve === resolve) {
              state.pendingPermission = undefined;
              resolve({ behavior: 'deny', message: 'Đã hủy bởi người dùng.' });
            }
          };
          signal.addEventListener('abort', onAbort, { once: true });
        });
      };
    } else {
      options.permissionMode = config.permissionMode;
    }

    // Extra CLI args — SDK tự thêm prefix '--' vào key của extraArgs
    // nên key KHÔNG được có '--' prefix, nếu không sẽ thành '----key'
    const extraArgs: Record<string, string | null> = {};

    if (config.effortLevel) {
      extraArgs['effort'] = config.effortLevel;
    }

    if (config.maxBudgetUsd) {
      extraArgs['max-budget-usd'] = config.maxBudgetUsd.toString();
    }

    // System prompt → SDK hỗ trợ native qua options.customSystemPrompt
    if (config.systemPrompt) {
      options.customSystemPrompt = config.systemPrompt;
    }

    // Custom args từ config — strip '--' prefix nếu user truyền sẵn
    if (config.customArgs && config.customArgs.length > 0) {
      for (let i = 0; i < config.customArgs.length; i += 2) {
        let key = config.customArgs[i];
        // Loại bỏ prefix '--' nếu có, vì SDK sẽ tự thêm
        key = key.replace(/^--/, '');
        const val = i + 1 < config.customArgs.length ? config.customArgs[i + 1] : null;
        extraArgs[key] = val;
      }
    }

    if (Object.keys(extraArgs).length > 0) {
      options.extraArgs = extraArgs;
    }

    // Session ID: khi session mới (không resume) → truyền session-id qua extraArgs
    // Key KHÔNG có prefix '--' vì SDK tự thêm
    if (!isResume) {
      if (!options.extraArgs) options.extraArgs = {};
      options.extraArgs['session-id'] = sessionId;
    }

    // --verbose: SDK đã thêm mặc định, không cần lặp lại

    // Log stderr từ CLI
    options.stderr = (data: string) => {
      logger.error(`[Claude stderr][${sessionId}]`, data);
    };

    // Set stream-close timeout cho interactive tools — SDK mặc định 5s quá ngắn
    // khi chờ user xác nhận permission. Giữ 5 phút (300s) theo chuẩn claudecodeui.
    const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

    // Periodic save mỗi 5s — lưu messages vào DB để refresh không mất
    const saveInterval = setInterval(() => {
      try {
        if (state.messages.length > 0) {
          const lastMsg = state.messages[state.messages.length - 1];
          if (lastMsg.role === 'assistant') {
            this.persistMessage(sessionId, lastMsg);
          }
        }
      } catch (err) {
        logger.warn(`[Claude][${sessionId}] Periodic save failed:`, err);
      }
    }, 5000);

    try {
      // ── Tích lũy blocks từ TẤT CẢ assistant events thành 1 message ──
      // SDK tách 1 lượt (thinking → tool_use → tool_result → text) thành nhiều
      // assistant events riêng. Ta gom lại để UI hiển thị gọn 1 message.
      const turnBlocks: ContentBlock[] = [];
      const turnToolCalls: ToolCall[] = [];
      const turnTextParts: string[] = [];
      let turnMsgId = `turn-${Date.now()}`;
      let turnModel: string | undefined;
      let turnTokensTotal = { input: 0, output: 0 };
      const turnStartedAt = Date.now();

      // Wrap prompt thành AsyncIterable — BẮT BUỘC khi dùng canUseTool.
      async function* createPromptStream() {
        yield {
          type: 'user' as const,
          session_id: sessionId,
          message: { role: 'user' as const, content: message },
          parent_tool_use_id: null,
        };
        await new Promise<void>((resolve) => {
          if (abortController.signal.aborted) { resolve(); return; }
          abortController.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }

      const queryResult = sdk.query({ prompt: createPromptStream(), options });

      if (prevStreamTimeout !== undefined) {
        process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
      } else {
        delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
      }

      for await (const sdkMsg of queryResult) {
        const type = sdkMsg.type as string;
        logger.debug(`[Claude][${sessionId}] SDK Event: ${type}`);

        switch (type) {
          case 'system': {
            logger.info(`[Claude] System init, session: ${sdkMsg.session_id}, model: ${sdkMsg.model}`);
            this.emit('system', { sessionId, data: sdkMsg });
            this.emit('status', { sessionId, status: 'thinking', startedAt: state.processingStartedAt });
            if (sdkMsg.model && !state.model) {
              state.model = sdkMsg.model;
              try { updateSession(sessionId, { model: state.model }); } catch {}
            }
            break;
          }

          case 'assistant': {
            // TÍCH LŨY vào turnBlocks — KHÔNG finalize ngay
            const apiMsg = sdkMsg.message;
            if (!apiMsg || !apiMsg.content) break;

            logger.info(`[Claude][${sessionId}] assistant event (accumulated ${turnBlocks.length} blocks so far)`);

            // Lấy ID từ API event đầu tiên
            if (apiMsg.id && turnMsgId.startsWith('turn-')) {
              turnMsgId = apiMsg.id;
            }
            if (apiMsg.model) turnModel = apiMsg.model;
            if (apiMsg.usage) {
              turnTokensTotal.input += apiMsg.usage.input_tokens || 0;
              turnTokensTotal.output += apiMsg.usage.output_tokens || 0;
            }

            for (const block of apiMsg.content) {
              if (block.type === 'text' && block.text) {
                turnTextParts.push(block.text);
                turnBlocks.push({ type: 'text', text: block.text });
                this.emit('stream', {
                  sessionId,
                  content: block.text,
                  messageId: `msg-${sessionId}-streaming`,
                });
              } else if (block.type === 'thinking') {
                const thinkingText = (block as any).thinking || (block as any).thought || (typeof (block as any).content === 'string' ? (block as any).content : '');
                if (thinkingText) {
                  turnBlocks.push({ type: 'thinking', thinking: thinkingText });
                  logger.info(`[Claude][${sessionId}] Thinking block (len: ${thinkingText.length})`);
                }
              } else if (block.type === 'tool_use') {
                const tc: ToolCall = {
                  id: block.id || uuidv4(),
                  name: block.name || 'unknown',
                  input: block.input || {},
                };
                turnToolCalls.push(tc);
                turnBlocks.push({ type: 'tool_use', tool: tc });
                this.emit('stream:tool', { sessionId, tool: tc });
                this.emit('status', { sessionId, status: 'tool_use', toolName: tc.name });
              } else if (block.type === 'tool_result') {
                // Match tool_use trong CÙNG turnBlocks — hoạt động cross-event vì cùng mảng
                const matchId = block.tool_use_id;
                const resultContent = typeof block.content === 'string'
                  ? block.content
                  : JSON.stringify(block.content);
                for (let i = turnBlocks.length - 1; i >= 0; i--) {
                  const b = turnBlocks[i];
                  if (b.type === 'tool_use' && (matchId ? b.tool.id === matchId : true)) {
                    b.tool.result = resultContent;
                    b.tool.isError = block.is_error;
                    break;
                  }
                }
                const tc2 = matchId
                  ? turnToolCalls.find(t => t.id === matchId)
                  : turnToolCalls[turnToolCalls.length - 1];
                if (tc2) {
                  tc2.result = resultContent;
                  tc2.isError = block.is_error;
                }
              } else {
                logger.debug(`[Claude][${sessionId}] Unhandled block type: ${block.type}`);
              }
            }

            // Cập nhật model cho session
            if (turnModel && !state.model) {
              state.model = turnModel;
              try { updateSession(sessionId, { model: state.model }); } catch {}
            }
            break;
          }

          case 'result': {
            const result = sdkMsg as any;
            const costUsd = result.total_cost_usd || 0;
            const durationMs = result.duration_ms || 0;
            const usage = result.usage;

            if (result.is_error) {
              logger.error(`[Claude] Result error:`, JSON.stringify(result, null, 2));
            }

            // ── Finalize 1 message duy nhất từ TẤT CẢ accumulated blocks ──
            if (turnBlocks.length > 0) {
              const totalDurationMs = Date.now() - turnStartedAt;
              const finalTokens = usage && (usage.input_tokens > 0 || usage.output_tokens > 0)
                ? { input: usage.input_tokens || 0, output: usage.output_tokens || 0 }
                : (turnTokensTotal.input > 0 || turnTokensTotal.output > 0) ? turnTokensTotal : undefined;

              const chatMsg: ChatMessage = {
                id: turnMsgId,
                role: 'assistant',
                content: turnTextParts.join('\n'),
                blocks: turnBlocks,
                toolCalls: turnToolCalls.length > 0 ? turnToolCalls : undefined,
                timestamp: new Date().toISOString(),
                model: turnModel,
                tokens: finalTokens,
                durationMs: durationMs > 0 ? durationMs : totalDurationMs,
                cost: costUsd > 0 ? costUsd : undefined,
              };
              this.finalizeAssistantMessage(sessionId, chatMsg);
              logger.info(`[Claude][${sessionId}] ✅ Finalized: ${turnBlocks.length} blocks, ${turnToolCalls.length} tools`);
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
              this.persistMessage(sessionId, errorMsg);
              this.emit('result', { sessionId, result: errorMsg, data: result });
            } else if (costUsd > 0 || durationMs > 1000) {
              const finalMsg: ChatMessage = {
                id: `result-${Date.now()}`,
                role: 'system',
                content: `Completed: ${(durationMs / 1000).toFixed(1)}s · $${costUsd.toFixed(4)}`,
                timestamp: new Date().toISOString(),
                cost: costUsd,
              };
              state.messages.push(finalMsg);
              this.persistMessage(sessionId, finalMsg);
              this.emit('result', { sessionId, result: finalMsg, data: result });
            }

            if (result.permission_denials && result.permission_denials.length > 0) {
              logger.warn(`[Claude][${sessionId}] Permission denials:`, result.permission_denials);
            }

            state.isProcessing = false;
            state.pendingPermission = undefined;
            this.emit('status', { sessionId, status: 'idle' });

            if (!abortController.signal.aborted) {
              abortController.abort();
            }
            break;
          }

          default: {
            this.emit('raw', { sessionId, event: sdkMsg });
            break;
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        logger.info(`[Claude] Query aborted for ${sessionId}`);
      } else {
        throw err;
      }
    } finally {
      clearInterval(saveInterval);
      state.abortController = undefined;
      state.pendingPermission = undefined;
      if (state.isProcessing) {
        state.isProcessing = false;
        this.emit('status', { sessionId, status: 'idle' });
      }
    }
  }

  /**
   * Xử lý phản hồi permission từ user (qua WebSocket).
   * Gọi khi user chọn Allow hoặc Deny trên UI.
   */
  resolvePermission(sessionId: string, allowed: boolean): void {
    const state = this.sessions.get(sessionId);
    if (!state || !state.pendingPermission) {
      logger.warn(`[Claude] No pending permission for ${sessionId}`);
      return;
    }

    const { toolName, input, resolve } = state.pendingPermission;
    state.pendingPermission = undefined;

    if (allowed) {
      logger.info(`[Claude][${sessionId}] Permission ALLOWED for ${toolName}`);
      resolve({
        behavior: 'allow',
        updatedInput: input,
      });
    } else {
      logger.info(`[Claude][${sessionId}] Permission DENIED for ${toolName}`);
      resolve({
        behavior: 'deny',
        message: 'Người dùng từ chối hành động này.',
      });
    }
  }

  /**
   * Finalize assistant message — thêm vào history, lưu DB, notify frontend.
   * Xử lý trùng lặp khi CLI emit cùng message id 2 lần.
   */
  private finalizeAssistantMessage(sessionId: string, chatMsg: ChatMessage): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      logger.warn(`[Claude] finalizeAssistantMessage: session not found for ${sessionId}`);
      return;
    }

    const existingIdx = state.messages.findIndex(m => m.id === chatMsg.id);
    if (existingIdx >= 0) {
      const existing = state.messages[existingIdx];
      const newContentLen = chatMsg.content?.length || 0;
      const existingContentLen = existing.content?.length || 0;
      const newBlocksLen = chatMsg.blocks?.length || 0;
      const existingBlocksLen = existing.blocks?.length || 0;

      if (newContentLen > existingContentLen || newBlocksLen > existingBlocksLen) {
        logger.info(`[Claude] Updating existing message ${chatMsg.id}: content ${existingContentLen}→${newContentLen}, blocks ${existingBlocksLen}→${newBlocksLen}`);
        state.messages[existingIdx] = { ...existing, ...chatMsg };
        try {
          updateMessageMeta(sessionId, {
            id: chatMsg.id,
            model: chatMsg.model,
            cost: chatMsg.cost,
            durationMs: chatMsg.durationMs,
            tokens: chatMsg.tokens,
          });
          const { default: db } = require('./db');
          db.prepare(`
            UPDATE chat_messages SET content = ?, blocks = ?, tool_calls = ? WHERE session_id = ? AND id = ?
          `).run(
            chatMsg.content,
            chatMsg.blocks ? JSON.stringify(chatMsg.blocks) : null,
            chatMsg.toolCalls ? JSON.stringify(chatMsg.toolCalls) : null,
            sessionId,
            chatMsg.id,
          );
        } catch (err) {
          logger.error(`[Claude] Error updating message content:`, err);
        }
        this.emit('message', { sessionId, message: state.messages[existingIdx] });
      } else {
        logger.warn(`[Claude] finalizeAssistantMessage: duplicate ${chatMsg.id} — skipping`);
      }
      return;
    }

    logger.info(`[Claude] ✅ Finalizing assistant message for ${sessionId}: id=${chatMsg.id}, contentLen=${chatMsg.content?.length || 0}, blocks=${chatMsg.blocks?.length || 0}`);

    try {
      state.messages.push(chatMsg);
      this.persistMessage(sessionId, chatMsg);
      this.emit('message', { sessionId, message: chatMsg });
    } catch (err) {
      logger.error(`[Claude] Error in finalizeAssistantMessage for ${sessionId}:`, err);
    }
  }

  /**
   * Abort session hiện tại — gửi signal abort cho SDK query
   */
  abortSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state?.abortController) {
      state.abortController.abort();
      state.abortController = undefined;
    }
  }

  /**
   * Dừng và xóa session khỏi memory
   */
  stopSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      if (state.abortController) state.abortController.abort();
      this.sessions.delete(sessionId);
      this.emit('session:ended', { sessionId });
    }
  }

  /**
   * Kiểm tra session có active trong memory không
   */
  isSessionActive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Danh sách session IDs đang active
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Danh sách sessionId đang processing (isProcessing = true).
   * Dùng cho sidebar hiển thị trạng thái.
   */
  getProcessingSessions(): string[] {
    const result: string[] = [];
    for (const [sessionId, state] of this.sessions.entries()) {
      if (state.isProcessing) {
        result.push(sessionId);
      }
    }
    return result;
  }

  /**
   * Lấy sessionId active cho một project
   */
  getActiveSessionForProject(projectId: string): string | null {
    for (const [sessionId, state] of this.sessions.entries()) {
      if (state.projectId === projectId) {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * Cleanup tất cả sessions khi shutdown
   */
  cleanup(): void {
    for (const [sessionId] of this.sessions) {
      this.stopSession(sessionId);
    }
  }
  /**
   * Nén context hội thoại (compact).
   * Flow: Gọi SDK tóm tắt hội thoại hiện tại → tạo session mới → chèn bản tóm tắt.
   * Trả về sessionId mới nếu thành công, throw nếu thất bại.
   */
  async compactSession(sessionId: string): Promise<string> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      // Thử load từ DB
      const saved = getSession(sessionId);
      if (!saved || saved.messages.length === 0) {
        throw new Error('Không tìm thấy session hoặc session trống.');
      }
      return this.compactFromMessages(saved.messages, saved.projectId || '', sessionId);
    }

    if (state.isProcessing) {
      throw new Error('Session đang xử lý, hãy đợi hoàn thành.');
    }

    if (state.messages.length < 2) {
      throw new Error('Hội thoại quá ngắn để nén.');
    }

    return this.compactFromMessages(state.messages, state.projectId, sessionId);
  }

  /**
   * Thực hiện compact: gọi SDK tóm tắt → tạo session mới.
   */
  private async compactFromMessages(
    msgs: ChatMessage[],
    projectId: string,
    oldSessionId: string,
  ): Promise<string> {
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // Build conversation text để gửi cho Claude tóm tắt
    const conversationText = msgs
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `[${m.role}]: ${m.content || '(no text)'}`)
      .join('\n\n');

    // Giới hạn text gửi đi — tránh quá dài
    const maxChars = 50000;
    const truncatedText = conversationText.length > maxChars
      ? conversationText.slice(-maxChars) + '\n\n(... phần đầu đã bị cắt bớt)'
      : conversationText;

    const summaryPrompt = `Hãy tóm tắt ngắn gọn cuộc hội thoại sau thành một bản tóm lược context. Chỉ giữ lại thông tin quan trọng: quyết định đã đưa ra, code đã thay đổi, vấn đề đang giải quyết, và bất kỳ context nào cần thiết để tiếp tục cuộc hội thoại. Viết dưới dạng bullet points ngắn gọn, bằng ngôn ngữ gốc của cuộc hội thoại.\n\n---\n${truncatedText}\n---\n\nTóm tắt:`;

    logger.info(`[Claude][compact] Summarizing ${msgs.length} messages for session ${oldSessionId}`);

    const sdk = await getSDK();

    // Gọi SDK query đơn giản — không resume, không canUseTool, session tạm
    const options: Record<string, any> = {
      cwd: project.path,
      pathToClaudeCodeExecutable: CLAUDE_BIN,
      permissionMode: 'plan', // Plan mode — không cần permission
    };

    let summaryText = '';

    try {
      const queryResult = sdk.query({ prompt: summaryPrompt, options });

      for await (const sdkMsg of queryResult) {
        const type = sdkMsg.type as string;

        if (type === 'assistant') {
          const apiMsg = sdkMsg.message;
          if (apiMsg?.content) {
            for (const block of apiMsg.content) {
              if (block.type === 'text' && block.text) {
                summaryText += block.text;
              }
            }
          }
        }
        // Bỏ qua các event khác (system, result, ...)
      }
    } catch (err: any) {
      logger.error(`[Claude][compact] SDK query error:`, err);
      throw new Error('Không thể tóm tắt hội thoại: ' + (err.message || String(err)));
    }

    if (!summaryText.trim()) {
      throw new Error('Claude không trả về bản tóm tắt.');
    }

    logger.info(`[Claude][compact] Summary generated: ${summaryText.length} chars`);

    // Tạo session mới
    const newSessionId = uuidv4();
    createSession({
      id: newSessionId,
      projectId,
      sessionId: newSessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isActive: true,
      name: `(compact) ${this.sessions.get(oldSessionId)?.sessionName || 'Hội thoại nén'}`,
    });

    // Chèn bản tóm tắt làm system message đầu tiên
    const contextMsg: ChatMessage = {
      id: `compact-${Date.now()}`,
      role: 'system',
      content: `📋 **Bản tóm tắt từ phiên trước:**\n\n${summaryText}`,
      timestamp: new Date().toISOString(),
    };
    addMessage(newSessionId, contextMsg);

    // Khởi tạo state cho session mới trong memory
    const oldState = this.sessions.get(oldSessionId);
    const newState: ClaudeSessionState = {
      sessionId: newSessionId,
      projectId,
      isProcessing: false,
      messages: [contextMsg],
      model: oldState?.model,
      effortLevel: oldState?.effortLevel,
      permissionMode: oldState?.permissionMode,
      sessionName: `(compact) ${oldState?.sessionName || 'Hội thoại nén'}`,
    };
    this.sessions.set(newSessionId, newState);

    // Cập nhật activeSessionId cho project
    try {
      const projectService = require('./project');
      projectService.updateProject(projectId, { activeSessionId: newSessionId });
    } catch {}

    logger.info(`[Claude][compact] Created new session ${newSessionId} from ${oldSessionId}`);
    return newSessionId;
  }
}

export const claudeService = new ClaudeService();
