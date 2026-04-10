"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claudeService = void 0;
const uuid_1 = require("uuid");
const events_1 = require("events");
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
const project_1 = require("./project");
const session_1 = require("./session");
const logger_1 = require("./logger");
/**
 * Resolve đường dẫn tuyệt đối của Claude CLI executable.
 * SDK cần biết đường dẫn tới binary claude để spawn nó bên dưới.
 */
function resolveClaudeBinary() {
    const home = os_1.default.homedir();
    const candidates = [
        path_1.default.join(home, '.local', 'bin', 'claude'),
        path_1.default.join(home, '.claude', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
    ];
    for (const candidate of candidates) {
        if (fs_1.default.existsSync(candidate)) {
            logger_1.logger.info(`[ClaudeService] Found Claude CLI at: ${candidate}`);
            return candidate;
        }
    }
    logger_1.logger.warn('[ClaudeService] Claude CLI not found at known paths, falling back to "claude"');
    return 'claude';
}
/** Đường dẫn tuyệt đối của Claude CLI — resolve 1 lần khi module load */
const CLAUDE_BIN = resolveClaudeBinary();
// ─── SDK Types ───────────────────────────────────────────────────────────────
// SDK là ESM, cần dynamic import(). Cache lại module sau lần load đầu.
let sdkModule = null;
/** Lazy-load @anthropic-ai/claude-code SDK (ESM package trong CJS context) */
async function getSDK() {
    if (!sdkModule) {
        sdkModule = await Promise.resolve().then(() => __importStar(require('@anthropic-ai/claude-code')));
    }
    return sdkModule;
}
class ClaudeService extends events_1.EventEmitter {
    sessions = new Map();
    getSessionState(sessionId) {
        const state = this.sessions.get(sessionId);
        if (state) {
            return {
                messages: state.messages,
                isProcessing: state.isProcessing,
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
        const saved = (0, session_1.getSession)(sessionId);
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
    setSessionEffortLevel(sessionId, effortLevel) {
        const state = this.sessions.get(sessionId);
        if (state) {
            state.effortLevel = effortLevel;
        }
        (0, session_1.updateSession)(sessionId, { effortLevel });
    }
    /**
     * Lấy effort level hiện tại của session.
     */
    getSessionEffortLevel(sessionId) {
        const state = this.sessions.get(sessionId);
        if (state)
            return state.effortLevel;
        const saved = (0, session_1.getSession)(sessionId);
        return saved?.effortLevel;
    }
    /**
     * Cập nhật permission mode cho một session đang active hoặc đã lưu.
     */
    setSessionPermissionMode(sessionId, permissionMode) {
        const state = this.sessions.get(sessionId);
        if (state) {
            state.permissionMode = permissionMode;
        }
        (0, session_1.updateSession)(sessionId, { permissionMode });
    }
    /**
     * Lấy permission mode hiện tại của session.
     */
    getSessionPermissionMode(sessionId) {
        const state = this.sessions.get(sessionId);
        if (state)
            return state.permissionMode;
        const saved = (0, session_1.getSession)(sessionId);
        return saved?.permissionMode;
    }
    /**
     * Kiểm tra xem Claude CLI có file conversation cho session này không.
     * CLI lưu tại: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
     * Đường dẫn cwd được encode: '/' → '-', bỏ trailing slash.
     */
    hasCliSession(sessionId, cwd) {
        try {
            // Claude CLI encode cwd: thay tất cả ký tự không phải alphanumeric/dash thành '-'
            // Ví dụ: /Users/tampv/Projects/tampv.com → -Users-tampv-Projects-tampv-com
            const encodedCwd = cwd.replace(/[^a-zA-Z0-9-]/g, '-');
            const claudeDir = path_1.default.join(os_1.default.homedir(), '.claude', 'projects', encodedCwd);
            const sessionFile = path_1.default.join(claudeDir, `${sessionId}.jsonl`);
            const exists = fs_1.default.existsSync(sessionFile);
            logger_1.logger.debug(`[ClaudeService] hasCliSession: ${sessionFile} → ${exists}`);
            return exists;
        }
        catch (err) {
            logger_1.logger.warn(`[ClaudeService] hasCliSession check failed:`, err);
            return false;
        }
    }
    /**
     * Thêm 1 message vào CSDL.
     */
    persistMessage(sessionId, msg) {
        try {
            (0, session_1.addMessage)(sessionId, msg);
        }
        catch (err) {
            logger_1.logger.error(`[ClaudeService] Lỗi khi lưu message ${msg.id}:`, err);
        }
    }
    /**
     * Khởi tạo hoặc attach vào một session.
     * Nếu session đã có trong memory → trả lại luôn.
     * Nếu có trong DB → load messages.
     * Nếu chưa có → tạo mới trong DB.
     */
    async startSession(projectId, existingSessionId, effortLevel) {
        const isUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        const sessionId = (existingSessionId && isUuid(existingSessionId))
            ? existingSessionId
            : (0, uuid_1.v4)();
        logger_1.logger.info(`[ClaudeService] Using sessionId=${sessionId}`);
        const project = (0, project_1.getProject)(projectId);
        if (!project)
            throw new Error(`Project not found: ${projectId}`);
        // Session đã có trong memory → trả về luôn
        if (this.sessions.has(sessionId)) {
            logger_1.logger.info(`[ClaudeService] Session ${sessionId} found in memory`);
            return sessionId;
        }
        const savedSession = (0, session_1.getSession)(sessionId);
        if (savedSession) {
            logger_1.logger.info(`[ClaudeService] Session ${sessionId} loaded from disk with ${savedSession.messages.length} messages`);
        }
        else {
            logger_1.logger.info(`[ClaudeService] Session ${sessionId} not found on disk, creating new`);
        }
        const state = {
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
            (0, session_1.createSession)({
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
                (0, session_1.updateSession)(sessionId, { effortLevel });
            }
            catch (e) {
                logger_1.logger.warn(`[ClaudeService] Failed to persist session effortLevel:`, e);
            }
        }
        // Cập nhật activeSessionId cho project
        if (project.activeSessionId !== sessionId) {
            try {
                const projectService = require('./project');
                projectService.updateProject(projectId, { activeSessionId: sessionId });
                logger_1.logger.info(`[ClaudeService] Updated project ${projectId} activeSessionId to ${sessionId}`);
            }
            catch (err) {
                logger_1.logger.error('[ClaudeService] Failed to update project activeSessionId:', err);
            }
        }
        this.sessions.set(sessionId, state);
        return sessionId;
    }
    /**
     * Gửi message tới Claude SDK.
     * SDK tự spawn CLI process, xử lý stdin/stdout, và trả về AsyncGenerator<SDKMessage>.
     */
    sendMessage(sessionId, message) {
        const state = this.sessions.get(sessionId);
        if (!state) {
            throw new Error(`No active session: ${sessionId}`);
        }
        if (state.isProcessing) {
            throw new Error(`Session ${sessionId} is already processing`);
        }
        state.isProcessing = true;
        this.emit('status', { sessionId, status: 'thinking' });
        // Lưu user message vào state + DB
        const chatMsg = {
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
            try {
                (0, session_1.updateSession)(sessionId, { name: shortName });
            }
            catch { }
        }
        const project = (0, project_1.getProject)(state.projectId);
        const config = (0, config_1.getConfig)();
        // Merge config: session-level ưu tiên hơn global
        const effectiveModel = state.model || config.model;
        const effectiveEffort = state.effortLevel || config.effortLevel;
        const effectivePermission = state.permissionMode || config.permissionMode;
        // Chốt model cho session nếu chưa có
        if (!state.model && effectiveModel) {
            state.model = effectiveModel;
            try {
                (0, session_1.updateSession)(sessionId, { model: state.model });
            }
            catch { }
        }
        // Chốt effortLevel cho session nếu chưa có
        if (!state.effortLevel && effectiveEffort) {
            state.effortLevel = effectiveEffort;
            try {
                (0, session_1.updateSession)(sessionId, { effortLevel: state.effortLevel });
            }
            catch { }
        }
        // Chạy SDK query async — không block
        this.runSDKQuery(sessionId, message, {
            cwd: project.path,
            model: effectiveModel,
            effortLevel: effectiveEffort,
            permissionMode: effectivePermission,
            systemPrompt: config.systemPrompt,
            maxBudgetUsd: config.maxBudgetUsd,
            customArgs: config.customArgs,
        }).catch((err) => {
            logger_1.logger.error(`[ClaudeService] SDK query error for ${sessionId}:`, err);
            this.emit('error', { sessionId, error: err.message || String(err) });
            state.isProcessing = false;
            this.emit('status', { sessionId, status: 'idle' });
        });
    }
    /**
     * Chạy SDK query() và xử lý stream messages.
     * Đây là core logic — thay thế toàn bộ spawnClaudeProcess + handleOutput + processStreamEvent cũ.
     */
    async runSDKQuery(sessionId, message, config) {
        const state = this.sessions.get(sessionId);
        if (!state)
            return;
        const sdk = await getSDK();
        // Quyết định resume hay session mới dựa trên file .jsonl thực tế trong Claude CLI storage.
        // App DB (database.sqlite) và CLI storage (~/.claude/projects/) là 2 hệ thống tách biệt.
        // Chỉ resume khi CLI thực sự có conversation file — tránh lỗi "No conversation found".
        const isResume = this.hasCliSession(sessionId, config.cwd);
        logger_1.logger.info(`[Claude] Session ${sessionId}: cliSessionExists=${isResume}, strategy=${isResume ? 'resume' : 'new'}`);
        const abortController = new AbortController();
        state.abortController = abortController;
        // Build SDK options
        const options = {
            abortController,
            cwd: config.cwd,
            pathToClaudeCodeExecutable: CLAUDE_BIN,
        };
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
            options.canUseTool = async (toolName, input, { signal }) => {
                logger_1.logger.info(`[Claude][${sessionId}] canUseTool called for: ${toolName}`);
                // Tạo Promise chờ user phản hồi từ frontend
                return new Promise((resolve, reject) => {
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
        }
        else {
            options.permissionMode = config.permissionMode;
        }
        // Extra CLI args — SDK tự thêm prefix '--' vào key của extraArgs
        // nên key KHÔNG được có '--' prefix, nếu không sẽ thành '----key'
        const extraArgs = {};
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
            if (!options.extraArgs)
                options.extraArgs = {};
            options.extraArgs['session-id'] = sessionId;
        }
        // --verbose: SDK đã thêm mặc định, không cần lặp lại
        // Log stderr từ CLI
        options.stderr = (data) => {
            logger_1.logger.error(`[Claude stderr][${sessionId}]`, data);
        };
        // Set stream-close timeout cho interactive tools — SDK mặc định 5s quá ngắn
        // khi chờ user xác nhận permission. Giữ 5 phút (300s) theo chuẩn claudecodeui.
        const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
        process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';
        try {
            // Tích lũy blocks cho message hiện tại
            let pendingBlocks = [];
            let assistantMsgId;
            let assistantModel;
            let assistantTokens;
            // Wrap prompt thành AsyncIterable — BẮT BUỘC khi dùng canUseTool.
            // Generator phải giữ sống (không return) sau khi yield message đầu tiên,
            // nếu không SDK sẽ đóng stdin → CLI tự deny mọi permission request.
            async function* createPromptStream() {
                yield {
                    type: 'user',
                    session_id: sessionId,
                    message: { role: 'user', content: message },
                    parent_tool_use_id: null,
                };
                // Giữ generator sống — chờ cho đến khi abort hoặc SDK tự đóng
                await new Promise((resolve) => {
                    if (abortController.signal.aborted) {
                        resolve();
                        return;
                    }
                    abortController.signal.addEventListener('abort', () => resolve(), { once: true });
                });
            }
            const queryResult = sdk.query({ prompt: createPromptStream(), options });
            // Restore env ngay — Query constructor đã capture giá trị rồi
            if (prevStreamTimeout !== undefined) {
                process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
            }
            else {
                delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
            }
            for await (const sdkMsg of queryResult) {
                const type = sdkMsg.type;
                logger_1.logger.debug(`[Claude][${sessionId}] SDK Event: ${type}`);
                switch (type) {
                    case 'system': {
                        // System init — extract model info
                        logger_1.logger.info(`[Claude] System init, session: ${sdkMsg.session_id}, model: ${sdkMsg.model}`);
                        this.emit('system', { sessionId, data: sdkMsg });
                        // Cập nhật model từ system message nếu chưa có
                        if (sdkMsg.model && !state.model) {
                            state.model = sdkMsg.model;
                            try {
                                (0, session_1.updateSession)(sessionId, { model: state.model });
                            }
                            catch { }
                        }
                        break;
                    }
                    case 'assistant': {
                        // Assistant message — chứa toàn bộ content blocks
                        logger_1.logger.info(`[Claude][${sessionId}] Received 'assistant' message`);
                        const apiMsg = sdkMsg.message;
                        if (!apiMsg || !apiMsg.content)
                            break;
                        assistantMsgId = apiMsg.id || `msg-${Date.now()}`;
                        assistantModel = apiMsg.model;
                        const usage = apiMsg.usage;
                        if (usage) {
                            assistantTokens = {
                                input: usage.input_tokens || 0,
                                output: usage.output_tokens || 0,
                            };
                        }
                        // Parse content blocks
                        const textParts = [];
                        const toolCalls = [];
                        const blocks = [];
                        for (const block of apiMsg.content) {
                            if (block.type === 'text' && block.text) {
                                textParts.push(block.text);
                                blocks.push({ type: 'text', text: block.text });
                                // Emit streaming text cho real-time UI update
                                this.emit('stream', {
                                    sessionId,
                                    content: block.text,
                                    messageId: `msg-${sessionId}-streaming`,
                                });
                            }
                            else if (block.type === 'thinking' && block.thinking) {
                                blocks.push({ type: 'thinking', thinking: block.thinking });
                            }
                            else if (block.type === 'tool_use') {
                                const tc = {
                                    id: block.id || (0, uuid_1.v4)(),
                                    name: block.name || 'unknown',
                                    input: block.input || {},
                                };
                                toolCalls.push(tc);
                                blocks.push({ type: 'tool_use', tool: tc });
                                // Emit tool use status — kèm tên tool để frontend hiện chi tiết
                                this.emit('stream:tool', { sessionId, tool: tc });
                                this.emit('status', { sessionId, status: 'tool_use', toolName: tc.name });
                            }
                            else if (block.type === 'tool_result') {
                                // Gắn result vào tool block tương ứng
                                const matchId = block.tool_use_id;
                                for (let i = blocks.length - 1; i >= 0; i--) {
                                    const b = blocks[i];
                                    if (b.type === 'tool_use' && (matchId ? b.tool.id === matchId : true)) {
                                        b.tool.result = typeof block.content === 'string'
                                            ? block.content
                                            : JSON.stringify(block.content);
                                        b.tool.isError = block.is_error;
                                        break;
                                    }
                                }
                                // Cập nhật trong toolCalls array
                                const tc2 = matchId
                                    ? toolCalls.find(t => t.id === matchId)
                                    : toolCalls[toolCalls.length - 1];
                                if (tc2) {
                                    tc2.result = typeof block.content === 'string'
                                        ? block.content
                                        : JSON.stringify(block.content);
                                    tc2.isError = block.is_error;
                                }
                            }
                        }
                        // Finalize assistant message
                        const chatMsg2 = {
                            id: assistantMsgId || `msg-${Date.now()}`,
                            role: 'assistant',
                            content: textParts.join('\n'),
                            blocks: blocks.length > 0 ? blocks : undefined,
                            toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
                            timestamp: new Date().toISOString(),
                            model: assistantModel,
                            tokens: assistantTokens,
                        };
                        this.finalizeAssistantMessage(sessionId, chatMsg2);
                        // Reset tích lũy cho turn tiếp theo (multi-turn)
                        pendingBlocks = [];
                        assistantMsgId = undefined;
                        break;
                    }
                    case 'result': {
                        // Final result — chi phí, thời gian, usage
                        const result = sdkMsg;
                        const costUsd = result.total_cost_usd || 0;
                        const durationMs = result.duration_ms || 0;
                        const usage = result.usage;
                        if (result.is_error) {
                            logger_1.logger.error(`[Claude] Result error:`, JSON.stringify(result, null, 2));
                        }
                        // Cập nhật metadata cho assistant message cuối cùng
                        if (state.messages.length > 0) {
                            for (let i = state.messages.length - 1; i >= 0; i--) {
                                const msg = state.messages[i];
                                if (msg.role === 'assistant') {
                                    let changed = false;
                                    if (usage && (usage.input_tokens > 0 || usage.output_tokens > 0)) {
                                        const nextTokens = { input: usage.input_tokens || 0, output: usage.output_tokens || 0 };
                                        if (!msg.tokens || msg.tokens.input !== nextTokens.input || msg.tokens.output !== nextTokens.output) {
                                            msg.tokens = nextTokens;
                                            changed = true;
                                        }
                                    }
                                    if (durationMs > 0 && msg.durationMs !== durationMs) {
                                        msg.durationMs = durationMs;
                                        changed = true;
                                    }
                                    if (costUsd > 0 && msg.cost !== costUsd) {
                                        msg.cost = costUsd;
                                        changed = true;
                                    }
                                    if (changed) {
                                        (0, session_1.updateMessageMeta)(sessionId, {
                                            id: msg.id,
                                            model: msg.model,
                                            cost: msg.cost,
                                            durationMs: msg.durationMs,
                                            tokens: msg.tokens,
                                        });
                                        this.emit('message', { sessionId, message: msg });
                                    }
                                    break;
                                }
                            }
                        }
                        // Emit result message nếu có lỗi hoặc thông tin chi phí
                        if (result.is_error || result.subtype === 'error_max_turns' || result.subtype === 'error_during_execution') {
                            const errorDetail = result.result || result.message || JSON.stringify(result);
                            const errorMsg = {
                                id: `result-${Date.now()}`,
                                role: 'system',
                                content: `Error: ${errorDetail}`,
                                timestamp: new Date().toISOString(),
                            };
                            state.messages.push(errorMsg);
                            this.persistMessage(sessionId, errorMsg);
                            this.emit('result', { sessionId, result: errorMsg, data: result });
                        }
                        else if (costUsd > 0 || durationMs > 1000) {
                            const finalMsg = {
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
                        // Denials log
                        if (result.permission_denials && result.permission_denials.length > 0) {
                            logger_1.logger.warn(`[Claude][${sessionId}] Permission denials:`, result.permission_denials);
                        }
                        // Emit idle NGAY khi nhận result — không đợi for-await loop đóng xong.
                        // Nếu chỉ dựa vào finally, UI có thể bị stuck thinking khi SDK stream chậm close.
                        state.isProcessing = false;
                        state.pendingPermission = undefined;
                        this.emit('status', { sessionId, status: 'idle' });
                        // Abort để giải phóng generator stream — generator đang await Promise vô hạn
                        if (!abortController.signal.aborted) {
                            abortController.abort();
                        }
                        break;
                    }
                    default: {
                        // Forward unknown events (user replay, etc.)
                        this.emit('raw', { sessionId, event: sdkMsg });
                        break;
                    }
                }
            }
        }
        catch (err) {
            // Kiểm tra abort error
            if (err.name === 'AbortError' || abortController.signal.aborted) {
                logger_1.logger.info(`[Claude] Query aborted for ${sessionId}`);
            }
            else {
                throw err;
            }
        }
        finally {
            // Safety net — đảm bảo luôn reset state dù đã emit ở case 'result'
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
    resolvePermission(sessionId, allowed) {
        const state = this.sessions.get(sessionId);
        if (!state || !state.pendingPermission) {
            logger_1.logger.warn(`[Claude] No pending permission for ${sessionId}`);
            return;
        }
        const { toolName, input, resolve } = state.pendingPermission;
        state.pendingPermission = undefined;
        if (allowed) {
            logger_1.logger.info(`[Claude][${sessionId}] Permission ALLOWED for ${toolName}`);
            resolve({
                behavior: 'allow',
                updatedInput: input,
            });
        }
        else {
            logger_1.logger.info(`[Claude][${sessionId}] Permission DENIED for ${toolName}`);
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
    finalizeAssistantMessage(sessionId, chatMsg) {
        const state = this.sessions.get(sessionId);
        if (!state) {
            logger_1.logger.warn(`[Claude] finalizeAssistantMessage: session not found for ${sessionId}`);
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
                logger_1.logger.info(`[Claude] Updating existing message ${chatMsg.id}: content ${existingContentLen}→${newContentLen}, blocks ${existingBlocksLen}→${newBlocksLen}`);
                state.messages[existingIdx] = { ...existing, ...chatMsg };
                try {
                    (0, session_1.updateMessageMeta)(sessionId, {
                        id: chatMsg.id,
                        model: chatMsg.model,
                        cost: chatMsg.cost,
                        durationMs: chatMsg.durationMs,
                        tokens: chatMsg.tokens,
                    });
                    const { default: db } = require('./db');
                    db.prepare(`
            UPDATE chat_messages SET content = ?, blocks = ?, tool_calls = ? WHERE session_id = ? AND id = ?
          `).run(chatMsg.content, chatMsg.blocks ? JSON.stringify(chatMsg.blocks) : null, chatMsg.toolCalls ? JSON.stringify(chatMsg.toolCalls) : null, sessionId, chatMsg.id);
                }
                catch (err) {
                    logger_1.logger.error(`[Claude] Error updating message content:`, err);
                }
                this.emit('message', { sessionId, message: state.messages[existingIdx] });
            }
            else {
                logger_1.logger.warn(`[Claude] finalizeAssistantMessage: duplicate ${chatMsg.id} — skipping`);
            }
            return;
        }
        logger_1.logger.info(`[Claude] ✅ Finalizing assistant message for ${sessionId}: id=${chatMsg.id}, contentLen=${chatMsg.content?.length || 0}, blocks=${chatMsg.blocks?.length || 0}`);
        try {
            state.messages.push(chatMsg);
            this.persistMessage(sessionId, chatMsg);
            this.emit('message', { sessionId, message: chatMsg });
        }
        catch (err) {
            logger_1.logger.error(`[Claude] Error in finalizeAssistantMessage for ${sessionId}:`, err);
        }
    }
    /**
     * Abort session hiện tại — gửi signal abort cho SDK query
     */
    abortSession(sessionId) {
        const state = this.sessions.get(sessionId);
        if (state?.abortController) {
            state.abortController.abort();
            state.abortController = undefined;
        }
    }
    /**
     * Dừng và xóa session khỏi memory
     */
    stopSession(sessionId) {
        const state = this.sessions.get(sessionId);
        if (state) {
            if (state.abortController)
                state.abortController.abort();
            this.sessions.delete(sessionId);
            this.emit('session:ended', { sessionId });
        }
    }
    /**
     * Kiểm tra session có active trong memory không
     */
    isSessionActive(sessionId) {
        return this.sessions.has(sessionId);
    }
    /**
     * Danh sách session IDs đang active
     */
    getActiveSessions() {
        return Array.from(this.sessions.keys());
    }
    /**
     * Danh sách sessionId đang processing (isProcessing = true).
     * Dùng cho sidebar hiển thị trạng thái.
     */
    getProcessingSessions() {
        const result = [];
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
    getActiveSessionForProject(projectId) {
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
    cleanup() {
        for (const [sessionId] of this.sessions) {
            this.stopSession(sessionId);
        }
    }
    /**
     * Nén context hội thoại (compact).
     * Flow: Gọi SDK tóm tắt hội thoại hiện tại → tạo session mới → chèn bản tóm tắt.
     * Trả về sessionId mới nếu thành công, throw nếu thất bại.
     */
    async compactSession(sessionId) {
        const state = this.sessions.get(sessionId);
        if (!state) {
            // Thử load từ DB
            const saved = (0, session_1.getSession)(sessionId);
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
    async compactFromMessages(msgs, projectId, oldSessionId) {
        const project = (0, project_1.getProject)(projectId);
        if (!project)
            throw new Error(`Project not found: ${projectId}`);
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
        logger_1.logger.info(`[Claude][compact] Summarizing ${msgs.length} messages for session ${oldSessionId}`);
        const sdk = await getSDK();
        // Gọi SDK query đơn giản — không resume, không canUseTool, session tạm
        const options = {
            cwd: project.path,
            pathToClaudeCodeExecutable: CLAUDE_BIN,
            permissionMode: 'plan', // Plan mode — không cần permission
        };
        let summaryText = '';
        try {
            const queryResult = sdk.query({ prompt: summaryPrompt, options });
            for await (const sdkMsg of queryResult) {
                const type = sdkMsg.type;
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
        }
        catch (err) {
            logger_1.logger.error(`[Claude][compact] SDK query error:`, err);
            throw new Error('Không thể tóm tắt hội thoại: ' + (err.message || String(err)));
        }
        if (!summaryText.trim()) {
            throw new Error('Claude không trả về bản tóm tắt.');
        }
        logger_1.logger.info(`[Claude][compact] Summary generated: ${summaryText.length} chars`);
        // Tạo session mới
        const newSessionId = (0, uuid_1.v4)();
        (0, session_1.createSession)({
            id: newSessionId,
            projectId,
            sessionId: newSessionId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isActive: true,
            name: `(compact) ${this.sessions.get(oldSessionId)?.sessionName || 'Hội thoại nén'}`,
        });
        // Chèn bản tóm tắt làm system message đầu tiên
        const contextMsg = {
            id: `compact-${Date.now()}`,
            role: 'system',
            content: `📋 **Bản tóm tắt từ phiên trước:**\n\n${summaryText}`,
            timestamp: new Date().toISOString(),
        };
        (0, session_1.addMessage)(newSessionId, contextMsg);
        // Khởi tạo state cho session mới trong memory
        const oldState = this.sessions.get(oldSessionId);
        const newState = {
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
        }
        catch { }
        logger_1.logger.info(`[Claude][compact] Created new session ${newSessionId} from ${oldSessionId}`);
        return newSessionId;
    }
}
exports.claudeService = new ClaudeService();
//# sourceMappingURL=claude.js.map