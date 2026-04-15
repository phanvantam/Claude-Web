import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import { ChatMessage } from '../../types';
import { getConfig } from '../config';
import { getProject } from '../project';
import { getSession, createSession, updateSession } from '../session';
import { logger } from '../logger';
import { ClaudeSessionState } from './types';
import { persistMessage } from './messageHelpers';
import { runSDKQuery } from './sdkRunner';
import { compactSession as compactSessionHandler } from './compact';
import * as subAgentManager from './subAgentManager';

export class ClaudeService extends EventEmitter {
  private sessions: Map<string, ClaudeSessionState> = new Map();

  // ─── Session Lifecycle ──────────────────────────────────────────────────

  /**
   * Khởi tạo hoặc attach vào một session.
   * Nếu session đã có trong memory → trả lại luôn.
   * Nếu có trong DB → load messages.
   * Nếu chưa có → tạo mới trong DB.
   */
  async startSession(projectId: string, existingSessionId?: string, effortLevel?: string): Promise<string> {
    const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const sessionId = (existingSessionId && isUuid(existingSessionId)) ? existingSessionId : uuidv4();

    logger.info(`[ClaudeService] Using sessionId=${sessionId}`);
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    // Nếu session đã có trong memory → giữ nguyên state hiện tại (bao gồm isProcessing)
    if (this.sessions.has(sessionId)) {
      logger.info(`[ClaudeService] Session ${sessionId} found in memory, preserving current state`);
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

    // Nếu client truyền effortLevel mới → ghi đè và persist
    if (effortLevel !== undefined && state.effortLevel !== effortLevel) {
      state.effortLevel = effortLevel;
      try { updateSession(sessionId, { effortLevel }); } catch (e) {
        logger.warn(`[ClaudeService] Failed to persist session effortLevel:`, e);
      }
    }

    // Cập nhật activeSessionId cho project
    if (project.activeSessionId !== sessionId) {
      try {
        const projectService = require('../project');
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
   * Throw lỗi nếu session không tồn tại hoặc đang processing — frontend cần feedback.
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
    this.emit('status', { sessionId, status: 'initializing', startedAt: state.processingStartedAt });

    // Lưu user message vào state + DB
    const chatMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    state.messages.push(chatMsg);
    persistMessage(sessionId, chatMsg);

    // Lưu tên phiên = tin nhắn user đầu tiên (chỉ chạy 1 lần)
    if (!state.sessionName) {
      const shortName = message.length > 80 ? message.slice(0, 80) + '...' : message;
      state.sessionName = shortName;
      try { updateSession(sessionId, { name: shortName }); } catch { }
    }

    const project = getProject(state.projectId);
    const config = getConfig();

    // Merge config: session-level ưu tiên hơn global
    const effectiveModel = state.model || config.model;
    const effectiveEffort = state.effortLevel || (config as any).effortLevel;
    const effectivePermission = state.permissionMode || config.permissionMode;

    // Chốt model cho session nếu chưa có — persist vào DB để reload không mất
    if (!state.model && effectiveModel) {
      state.model = effectiveModel;
      try { updateSession(sessionId, { model: state.model }); } catch { }
    }

    // Chốt effortLevel cho session nếu chưa có
    if (!state.effortLevel && effectiveEffort) {
      state.effortLevel = effectiveEffort;
      try { updateSession(sessionId, { effortLevel: state.effortLevel }); } catch { }
    }

    const effectiveSystemPrompt = config.systemPrompt;

    // Delegate sang sdkRunner — async, không block
    runSDKQuery(sessionId, message, {
      cwd: project!.path,
      model: effectiveModel,
      effortLevel: effectiveEffort,
      permissionMode: effectivePermission,
      systemPrompt: effectiveSystemPrompt,
      maxBudgetUsd: config.maxBudgetUsd,
      customArgs: config.customArgs,
    }, state, this).catch((err) => {
      logger.error(`[ClaudeService] SDK query error for ${sessionId}:`, err);
      this.emit('error', { sessionId, error: err.message || String(err) });
      state.isProcessing = false;
      this.emit('status', { sessionId, status: 'idle' });
    });
  }

  // ─── Getters ────────────────────────────────────────────────────────────

  getSessionState(sessionId: string) {
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
          input: state.pendingPermission.input,
        } : undefined,
        activeToolName: state.activeToolName,
        activeSubAgent: state.activeSubAgent,
        partialAssistantBlocks: state.partialAssistantBlocks,
        partialToolCalls: state.partialToolCalls,
        partialAssistantContent: state.partialAssistantContent,
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

  getActiveSessionForProject(projectId: string): string | null {
    for (const [sessionId, state] of this.sessions.entries()) {
      if (state.projectId === projectId) return sessionId;
    }
    return null;
  }

  getProcessingSessions(): string[] {
    const result: string[] = [];
    for (const [sessionId, state] of this.sessions.entries()) {
      if (state.isProcessing) result.push(sessionId);
    }
    return result;
  }

  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  isSessionActive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Lấy effort level hiện tại của session */
  getSessionEffortLevel(sessionId: string): string | undefined {
    const state = this.sessions.get(sessionId);
    if (state) return state.effortLevel;
    const saved = getSession(sessionId);
    return saved?.effortLevel;
  }

  /** Lấy permission mode hiện tại của session */
  getSessionPermissionMode(sessionId: string): string | undefined {
    const state = this.sessions.get(sessionId);
    if (state) return state.permissionMode;
    const saved = getSession(sessionId);
    return saved?.permissionMode;
  }

  // ─── Sub-agent Public API — delegate sang subAgentManager ───────────────

  /**
   * Lấy danh sách sub-agents cho session.
   * Delegate sang subAgentManager module.
   */
  listSubAgents(sessionId: string): any[] {
    return subAgentManager.listSubAgents(sessionId, this.sessions);
  }

  /**
   * Lấy timeline events của một sub-agent.
   * Delegate sang subAgentManager module.
   */
  getSubAgentTimeline(sessionId: string, agentId: string): any[] {
    return subAgentManager.getSubAgentTimeline(sessionId, agentId, this.sessions);
  }

  // ─── Control ────────────────────────────────────────────────────────────

  /**
   * Xử lý phản hồi permission từ user (qua WebSocket).
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
      resolve({ behavior: 'allow', updatedInput: input });
    } else {
      logger.info(`[Claude][${sessionId}] Permission DENIED for ${toolName}`);
      resolve({ behavior: 'deny', message: 'Người dùng từ chối hành động này.' });
    }
  }

  /**
   * Xử lý phản hồi AskUserQuestion từ user (qua WebSocket).
   * Dùng 'deny' + message chứa answer — vì AskUserQuestion tool nội bộ
   * không đọc updatedInput. Claude sẽ nhận message như câu trả lời từ user.
   */
  resolveAskUser(sessionId: string, answer: string): void {
    const state = this.sessions.get(sessionId);
    if (!state || !state.pendingPermission || state.pendingPermission.toolName !== 'AskUserQuestion') {
      logger.warn(`[Claude] No pending AskUserQuestion for ${sessionId}`);
      return;
    }

    const { resolve } = state.pendingPermission;
    state.pendingPermission = undefined;

    logger.info(`[Claude][${sessionId}] AskUserQuestion answered: ${answer.slice(0, 100)}`);
    // Trả answer qua deny message — Claude nhận message text là câu trả lời
    resolve({ behavior: 'deny', message: `Người dùng trả lời: ${answer}` });
  }

  abortSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    // Gọi interrupt() trên SDK query instance — đây mới thực sự kill CLI process.
    // AbortController chỉ signal cho canUseTool/pending permission, không dừng được tiến trình.
    if (state.queryInstance) {
      state.queryInstance.interrupt().catch((err: any) => {
        // Lỗi "Query closed" là bình thường khi query đã kết thúc
        if (!err?.message?.includes('Query closed')) {
          logger.warn(`[Claude][${sessionId}] interrupt() failed:`, err);
        }
      });
    }
    if (state.abortController) {
      state.abortController.abort();
      state.abortController = undefined;
    }
  }

  stopSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) {
      // Dừng tiến trình CLI trước khi xóa session khỏi memory
      if (state.queryInstance) {
        state.queryInstance.interrupt().catch(() => {});
      }
      if (state.abortController) state.abortController.abort();
      this.sessions.delete(sessionId);
      this.emit('session:ended', { sessionId });
    }
  }

  cleanup(): void {
    for (const [sessionId] of this.sessions) {
      this.stopSession(sessionId);
    }
  }

  setSessionEffortLevel(sessionId: string, effortLevel?: string): void {
    const state = this.sessions.get(sessionId);
    if (state) state.effortLevel = effortLevel;
    updateSession(sessionId, { effortLevel });
  }

  setSessionModel(sessionId: string, model?: string): void {
    const state = this.sessions.get(sessionId);
    if (state) state.model = model;
    updateSession(sessionId, { model });
  }

  setSessionPermissionMode(sessionId: string, permissionMode?: string): void {
    const state = this.sessions.get(sessionId);
    if (state) state.permissionMode = permissionMode;
    updateSession(sessionId, { permissionMode });
  }

  // ─── Compact — delegate sang compact.ts ─────────────────────────────────

  async compactSession(sessionId: string): Promise<string> {
    return compactSessionHandler(sessionId, this.sessions);
  }
}
