import os from 'os';
import path from 'path';
import { EventEmitter } from 'events';
import { ClaudeSessionState, SDKQueryConfig } from '../types';
import { logger } from '../../logger';
import { isAbortRequested } from './runtimeControl';

/**
 * Phân loại mức độ rủi ro của tool.
 * - LOW: chỉ đọc dữ liệu
 * - MEDIUM: ghi/sửa/xóa file
 * - HIGH: thực thi lệnh hệ thống, MCP, hoặc tool chưa rõ
 */
export type ToolRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/** Chuẩn hóa path về slash `/` để so sánh ổn định cross-platform. */
/** Expand ~ to home directory and normalize slashes. */
const normalizePath = (v: string) => {
  const expanded = v.startsWith('~/') ? v.replace(/^~/, os.homedir()) : v;
  return expanded.replace(/\\/g, '/');
};

/** Xác định risk level của tool hiện tại. */
export function getToolRiskLevel(tool: string): ToolRiskLevel {
  if (/^(Read|View|Cat|LS|List|Search|Grep|Glob|Find|Notebook|ExitPlan)/i.test(tool)
    || tool === 'ListCodeDefinitionNames'
    || tool === 'ListNotebooks') {
    return 'LOW';
  }

  if (/^(Write|Edit|MultiEdit|Move|Rename|Delete|Mkdir|Append|Create)/i.test(tool)) {
    return 'MEDIUM';
  }

  return 'HIGH';
}

export interface PlanPathContext {
  sessionId: string;
  config: SDKQueryConfig;
}

/**
 * Ép file kế hoạch luôn nằm trong `.claude/plans` của project.
 *
 * Why:
 * - Ngăn model ghi nhầm plan vào `~/.claude/plans/` global.
 * - Giữ toàn bộ artifacts kế hoạch trong project local.
 */
export function enforceProjectPlanPath(
  tool: string,
  toolInput: Record<string, unknown>,
  ctx: PlanPathContext,
): { deniedMessage?: string } {
  const isWriteTool = /^(Edit|Write|MultiEdit|Create)/i.test(tool);
  if (!isWriteTool) return {};

  const rawFilePath = typeof (toolInput as any).file_path === 'string'
    ? String((toolInput as any).file_path).trim()
    : '';
  if (!rawFilePath) return {};

  const projectPlansDir = path.resolve(ctx.config.cwd, '.claude', 'plans');
  const projectPlansDirWithSlash = `${projectPlansDir}/`;
  const normalizedProjectPlansDir = normalizePath(projectPlansDirWithSlash).replace(/\/+/g, '/');
  const projectPlansDirLower = normalizedProjectPlansDir.toLowerCase();

  const normalizedRawPath = normalizePath(rawFilePath);
  const lowerRawPath = normalizedRawPath.toLowerCase();
  const baseName = path.basename(normalizedRawPath);
  const baseNameLower = baseName.toLowerCase();
  const isMarkdown = baseNameLower.endsWith('.md');
  const looksLikePlanFile = isMarkdown && baseNameLower.includes('plan');

  // Detect if path belongs to ANY ~/.claude/plans/ (global) — always redirect to project dir
  const globalHomeDir = os.homedir().toLowerCase();
  const isGlobalPlansPath = lowerRawPath.startsWith(`${globalHomeDir}/.claude/plans/`)
    || lowerRawPath.startsWith('~/.claude/plans/');

  // Detect if path targets project-like plans folder (already correct)
  const isProjectPlansPath = lowerRawPath.startsWith(normalizedProjectPlansDir.toLowerCase())
    || lowerRawPath.startsWith('.claude/plans/')
    || lowerRawPath.startsWith('./.claude/plans/')
    || lowerRawPath.startsWith('plans/')
    || lowerRawPath.startsWith('./plans/')
    || lowerRawPath.includes('/.claude/plans/');

  if (!looksLikePlanFile && !isGlobalPlansPath && !isProjectPlansPath) return {};

  // If the path is inside project's plans dir, allow with optional normalization
  if (isProjectPlansPath && !isGlobalPlansPath) {
    let relativePlanPath = baseName || 'IMPLEMENTATION_PLAN.md';
    // Extract filename from any plans-path variant (use baseName which is already the filename)
    const slashIdx = normalizedRawPath.lastIndexOf('/plans/');
    if (slashIdx >= 0) relativePlanPath = normalizedRawPath.slice(slashIdx + '/plans/'.length) || relativePlanPath;
    if (!relativePlanPath) relativePlanPath = 'IMPLEMENTATION_PLAN.md';
    relativePlanPath = normalizePath(relativePlanPath).replace(/^\/+/, '').replace(/\.\./g, '');
    if (!relativePlanPath.endsWith('.md')) relativePlanPath = `${relativePlanPath}.md`;
    const resolvedPlanPath = path.resolve(projectPlansDir, relativePlanPath);
    const finalPath = path.resolve(resolvedPlanPath);
    if (normalizePath(rawFilePath) !== normalizePath(finalPath)) {
      logger.info(`[Claude][${ctx.sessionId}] Enforce plan path: ${rawFilePath} -> ${finalPath}`);
      (toolInput as any).file_path = finalPath;
    }
    return {};
  }

  // If global plans path or plan-like filename: always redirect to project plans dir
  let relativePlanPath = baseName || 'IMPLEMENTATION_PLAN.md';
  if (!relativePlanPath.endsWith('.md')) relativePlanPath = `${relativePlanPath}.md`;
  relativePlanPath = normalizePath(relativePlanPath).replace(/^\/+/, '').replace(/\.\./g, '');

  const resolvedPlanPath = path.resolve(projectPlansDir, relativePlanPath);
  const normalizedResolvedPlanPath = normalizePath(path.resolve(resolvedPlanPath));
  if (!normalizedResolvedPlanPath.startsWith(projectPlansDirLower)) {
    return { deniedMessage: `Invalid plan path: ${rawFilePath}` };
  }

  logger.info(`[Claude][${ctx.sessionId}] Enforce plan path: ${rawFilePath} -> ${resolvedPlanPath}`);
  (toolInput as any).file_path = path.resolve(resolvedPlanPath);
  return {};
}

export interface CanUseToolContext {
  sessionId: string;
  state: ClaudeSessionState;
  emitter: EventEmitter;
  config: SDKQueryConfig;
  permissionMode: string;
}

/**
 * Dựng callback canUseTool cho SDK.
 *
 * Why:
 * - Gom toàn bộ policy vào 1 nơi.
 * - Giữ sdkRunner.ts chỉ còn orchestration.
 */
export function buildCanUseToolHandler(ctx: CanUseToolContext) {
  const { sessionId, state, emitter, config } = ctx;

  return async (
    toolName: string,
    input: Record<string, unknown>,
    { signal }: { signal: AbortSignal },
  ) => {
    if (isAbortRequested(state)) {
      logger.info(`[Claude][${sessionId}] canUseTool denied because abort was requested`);
      return { behavior: 'deny' as const, message: 'Đã hủy theo yêu cầu người dùng.' };
    }

    const riskLevel = getToolRiskLevel(toolName);
    const currentParentToolUseId = state.currentParentToolUseId || null;
    const currentDepth = currentParentToolUseId
      ? (state.subAgentDepthByToolUseId?.[currentParentToolUseId] || state.activeSubAgentDepth || 1)
      : 0;

    logger.info(`[Claude][${sessionId}] canUseTool: ${toolName} (risk=${riskLevel}, mode=${ctx.permissionMode}, parent=${currentParentToolUseId || 'none'}, depth=${currentDepth})`);
    state.activeToolName = toolName;
    emitter.emit('status', { sessionId, status: 'tool_use', toolName });

    if (toolName === 'Agent') {
      if (!currentParentToolUseId) {
        logger.info(`[Claude][${sessionId}] Agent tool from main context keeps default permission flow`);
      } else {
        logger.warn(`[Claude][${sessionId}] Nested Agent denied (sub-agent -> sub-agent disabled)`);
        return {
          behavior: 'deny' as const,
          message: 'Nested Agent đã bị tắt: chỉ main conversation mới được gọi Agent.',
        };
      }
    }

    const planEnforce = enforceProjectPlanPath(toolName, input, { sessionId, config });
    if (planEnforce.deniedMessage) {
      logger.warn(`[Claude][${sessionId}] canUseTool denied: ${planEnforce.deniedMessage}`);
      return { behavior: 'deny' as const, message: planEnforce.deniedMessage };
    }

    // Guard: nếu AskUserQuestion đang pending → deny để tránh duplicate call
    if (toolName === 'AskUserQuestion') {
      if (state.pendingPermission?.toolName === 'AskUserQuestion') {
        logger.warn(`[Claude][${sessionId}] AskUserQuestion already pending, denying duplicate call`);
        return { behavior: 'deny' as const, message: 'AskUserQuestion đang chờ trả lời.' };
      }
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

    const projectPlansDir = path.resolve(config.cwd, '.claude', 'plans');
    const projectPlansDirWithSlash = `${projectPlansDir}/`;
    const normalizedProjectPlansDir = normalizePath(projectPlansDirWithSlash).replace(/\/+/g, '/');

    if (ctx.permissionMode === 'plan') {
      const planTools = /^(EnterPlanMode|ExitPlanMode)$/i;
      if (planTools.test(toolName)) {
        logger.warn(`[Claude][${sessionId}] Plan mode: deny tool ${toolName}`);
        return {
          behavior: 'deny' as const,
          message: `Plan Mode: calling ${toolName} is not allowed.`,
        };
      }

      const executionTools = /^(Bash|Monitor|TaskStop|ExitWorktree|EnterWorktree)$/i;
      if (executionTools.test(toolName)) {
        logger.info(`[Claude][${sessionId}] Plan mode: deny execution tool ${toolName}`);
        return {
          behavior: 'deny' as const,
          message: `Plan Mode: executing commands or running tasks is not allowed.`,
        };
      }

      const rawFilePath = typeof (input as any).file_path === 'string' ? String((input as any).file_path).trim() : '';
      const isWriteTool = /^(Edit|Write|MultiEdit|Create)/i.test(toolName);

      if (isWriteTool) {
        if (!rawFilePath) {
          return {
            behavior: 'deny' as const,
            message: `Plan Mode: tool ${toolName} requires file_path to be inside ${projectPlansDirWithSlash}`,
          };
        }

        let resolvedPath = rawFilePath;
        if (!path.isAbsolute(resolvedPath)) {
          resolvedPath = path.resolve(config.cwd, resolvedPath);
        }
        const normalizedResolvedPath = normalizePath(path.resolve(resolvedPath)).replace(/\/+/g, '/');

        if (!normalizedResolvedPath.startsWith(normalizedProjectPlansDir)) {
          logger.warn(`[Claude][${sessionId}] Plan mode: deny write outside plans dir ${resolvedPath}`);
          return {
            behavior: 'deny' as const,
            message: `Plan Mode: you may only write plan files to ${projectPlansDirWithSlash}`,
          };
        }

        (input as any).file_path = path.resolve(resolvedPath);
        logger.info(`[Claude][${sessionId}] Plan mode: allow write to plan file ${(input as any).file_path}`);
      }

      return { behavior: 'allow' as const, updatedInput: input };
    }

    if (ctx.permissionMode === 'bypassPermissions') {
      return { behavior: 'allow' as const, updatedInput: input };
    }

    if (ctx.permissionMode === 'acceptEdits' || ctx.permissionMode === 'auto') {
      if (riskLevel === 'LOW' || riskLevel === 'MEDIUM') {
        return { behavior: 'allow' as const, updatedInput: input };
      }
      logger.info(`[Claude][${sessionId}] ${ctx.permissionMode} mode: tool ${toolName} là HIGH risk, hỏi user`);
    }

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
}

/** Ghép chỉ thị system prompt cho plan path enforcement + plan mode. */
export function buildSystemPromptAppend(
  config: SDKQueryConfig,
  projectPlansDirWithSlash: string,
): string[] {
  const appendParts: string[] = [];

  appendParts.push(
    `[PLAN PATH ENFORCEMENT]`,
    `When creating or editing a plan file (.md), you MUST use the following directory: ${projectPlansDirWithSlash}`,
    `DO NOT save to ~/.claude/plans/ or any global/shared directory.`,
    `Use descriptive filenames, e.g.: refactor-auth-module.md, fix-payment-bug.md.`,
  );

  if (config.permissionMode === 'plan') {
    appendParts.push(
      `[PLAN MODE INSTRUCTIONS]`,
      `You are in Plan Mode. Goal: research + create a plan file. DO NOT execute or implement.`,
      ``,
      `Mandatory rules:`,
      `- You may ONLY write plan files to: ${projectPlansDirWithSlash}`,
      `- DO NOT modify any source code files`,
      `- DO NOT execute commands (Bash, Monitor, etc.)`,
      `- DO NOT call EnterPlanMode or ExitPlanMode`,
      ``,
      `Research guidance:`,
      `- Select appropriate skills/agents to research the codebase (e.g.: Explore, Plan, code-review)`,
      `- Use sequential-thinking MCP to evaluate and organize information`,
      `- Call skills/agents for research if needed, then synthesize using sequential-thinking`,
      `- Auto-generate a descriptive plan filename based on the content (e.g.: refactor-auth-module.md)`,
      `- Write the plan in Markdown format: Goal, Current State Analysis, Implementation Steps, Risks, Completion Criteria`,
    );
  }

  if (config.systemPrompt) {
    appendParts.push(config.systemPrompt);
  }

  return appendParts;
}
