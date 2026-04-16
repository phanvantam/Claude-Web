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
export const normalizePath = (v: string) => v.replace(/\\/g, '/');

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

  const normalizedRawPath = normalizePath(rawFilePath);
  const lowerRawPath = normalizedRawPath.toLowerCase();
  const baseName = path.basename(normalizedRawPath);
  const baseNameLower = baseName.toLowerCase();
  const isMarkdown = baseNameLower.endsWith('.md');
  const looksLikePlanFile = isMarkdown && baseNameLower.includes('plan');
  const targetsPlansFolder =
    lowerRawPath.includes('/.claude/plans/') ||
    lowerRawPath.startsWith('~/.claude/plans/') ||
    lowerRawPath.startsWith('.claude/plans/') ||
    lowerRawPath.startsWith('./.claude/plans/') ||
    lowerRawPath.startsWith('plans/') ||
    lowerRawPath.startsWith('./plans/');

  if (!looksLikePlanFile && !targetsPlansFolder) return {};

  let relativePlanPath = baseName || 'IMPLEMENTATION_PLAN.md';

  // Nếu input đã trỏ vào thư mục plans, preserve subpath.
  if (targetsPlansFolder) {
    const marker = '/.claude/plans/';
    if (lowerRawPath.includes(marker)) {
      relativePlanPath = normalizedRawPath.slice(lowerRawPath.lastIndexOf(marker) + marker.length) || relativePlanPath;
    } else if (lowerRawPath.startsWith('~/.claude/plans/')) {
      relativePlanPath = normalizedRawPath.slice('~/.claude/plans/'.length) || relativePlanPath;
    } else if (lowerRawPath.startsWith('./.claude/plans/')) {
      relativePlanPath = normalizedRawPath.slice('./.claude/plans/'.length) || relativePlanPath;
    } else if (lowerRawPath.startsWith('.claude/plans/')) {
      relativePlanPath = normalizedRawPath.slice('.claude/plans/'.length) || relativePlanPath;
    } else if (lowerRawPath.startsWith('./plans/')) {
      relativePlanPath = normalizedRawPath.slice('./plans/'.length) || relativePlanPath;
    } else if (lowerRawPath.startsWith('plans/')) {
      relativePlanPath = normalizedRawPath.slice('plans/'.length) || relativePlanPath;
    }
  }

  relativePlanPath = normalizePath(relativePlanPath).replace(/^\/+/, '').replace(/\.\./g, '');
  if (!relativePlanPath) relativePlanPath = 'IMPLEMENTATION_PLAN.md';
  if (!relativePlanPath.endsWith('.md')) relativePlanPath = `${relativePlanPath}.md`;

  const resolvedPlanPath = path.resolve(projectPlansDir, relativePlanPath);
  const normalizedResolvedPlanPath = normalizePath(path.resolve(resolvedPlanPath));
  if (!normalizedResolvedPlanPath.startsWith(normalizedProjectPlansDir)) {
    return { deniedMessage: `Đường dẫn plan không hợp lệ: ${rawFilePath}` };
  }

  if (normalizePath(rawFilePath) !== normalizePath(resolvedPlanPath)) {
    logger.info(`[Claude][${ctx.sessionId}] Enforce plan path: ${rawFilePath} -> ${resolvedPlanPath}`);
  }
  (toolInput as any).file_path = resolvedPlanPath;
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
    logger.info(`[Claude][${sessionId}] canUseTool: ${toolName} (risk=${riskLevel}, mode=${ctx.permissionMode})`);
    state.activeToolName = toolName;
    emitter.emit('status', { sessionId, status: 'tool_use', toolName });

    const planEnforce = enforceProjectPlanPath(toolName, input, { sessionId, config });
    if (planEnforce.deniedMessage) {
      logger.warn(`[Claude][${sessionId}] canUseTool denied: ${planEnforce.deniedMessage}`);
      return { behavior: 'deny' as const, message: planEnforce.deniedMessage };
    }

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

    const projectPlansDir = path.resolve(config.cwd, '.claude', 'plans');
    const projectPlansDirWithSlash = `${projectPlansDir}/`;
    const normalizedProjectPlansDir = normalizePath(projectPlansDirWithSlash).replace(/\/+/g, '/');

    if (ctx.permissionMode === 'plan') {
      // Chặn tuyệt đối các tool liên quan đến lập/triggers plan mode của Claude.
      // Plan mode chỉ dùng để nghiên cứu + viết file kế hoạch, không được gọi plan tools khác.
      const planTools = /^(EnterPlanMode|ExitPlanMode)$/i;
      if (planTools.test(toolName)) {
        logger.warn(`[Claude][${sessionId}] Plan mode: chặn tool kế hoạch ${toolName}`);
        return {
          behavior: 'deny' as const,
          message: `Chế độ lập kế hoạch: không được gọi tool ${toolName}. Chỉ được phân tích code và ghi file kế hoạch.`,
        };
      }

      // Cho phép tool Agent nếu sub-agent KHÔNG chứa EnterPlanMode/ExitPlanMode trong allowedTools.
      // Agent do user tạo phục vụ nghiên cứu vẫn được phép gọi.
      if (/^Agent$/i.test(toolName)) {
        const agentInput = input as any;
        const allowedTools = Array.isArray(agentInput.allowedTools) ? agentInput.allowedTools : [];
        const hasPlanTools = allowedTools.some((t: string) => planTools.test(t));
        if (hasPlanTools) {
          logger.warn(`[Claude][${sessionId}] Plan mode: chặn Agent vì sub-agent chứa plan tools`);
          return {
            behavior: 'deny' as const,
            message: `Chế độ lập kế hoạch: sub-agent không được chứa EnterPlanMode hay ExitPlanMode.`,
          };
        }
        logger.info(`[Claude][${sessionId}] Plan mode: cho phép Agent`);
        return { behavior: 'allow' as const, updatedInput: input };
      }

      // Cho phép các tool read-only phục vụ nghiên cứu codebase
      const allowedReadOnlyTools = /^(Read|Grep|Glob|WebFetch|WebSearch|ListMcpResourcesTool|ReadMcpResourceTool|mcp__.*__.*|smart_search|smart_outline|smart_unfold|search_graph|get_code_snippet|trace_path|query_graph|get_architecture|search_code)$/i;
      if (allowedReadOnlyTools.test(toolName)) {
        return { behavior: 'allow' as const, updatedInput: input };
      }

      const rawFilePath = typeof (input as any).file_path === 'string' ? String((input as any).file_path).trim() : '';
      const isWriteTool = /^(Edit|Write|MultiEdit|Create)/i.test(toolName);

      if (isWriteTool) {
        if (!rawFilePath) {
          return {
            behavior: 'deny' as const,
            message: `Chế độ lập kế hoạch: tool ${toolName} bắt buộc có file_path trong ${projectPlansDirWithSlash}`,
          };
        }

        let resolvedPath = rawFilePath;
        if (!path.isAbsolute(resolvedPath)) {
          resolvedPath = path.resolve(config.cwd, resolvedPath);
        }
        const normalizedResolvedPath = normalizePath(path.resolve(resolvedPath)).replace(/\/+/g, '/');

        if (!normalizedResolvedPath.startsWith(normalizedProjectPlansDir)) {
          logger.warn(`[Claude][${sessionId}] Plan mode: chặn ghi ngoài project plans dir ${resolvedPath}`);
          return {
            behavior: 'deny' as const,
            message: `Chế độ lập kế hoạch: chỉ được ghi kế hoạch trong ${projectPlansDirWithSlash}`,
          };
        }

        (input as any).file_path = path.resolve(resolvedPath);
        logger.info(`[Claude][${sessionId}] Plan mode: cho phép ghi plan file ${(input as any).file_path}`);
        return { behavior: 'allow' as const, updatedInput: input };
      }

      logger.info(`[Claude][${sessionId}] Plan mode: chặn tool ${toolName}`);
      return {
        behavior: 'deny' as const,
        message: `Chế độ lập kế hoạch: chỉ được phân tích, đọc code và ghi kế hoạch vào ${projectPlansDirWithSlash}. Không được sửa file source hay chạy lệnh.`,
      };
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
    `Nếu bạn tạo hoặc chỉnh sửa file kế hoạch (.md), PHẢI dùng đường dẫn trong thư mục: ${projectPlansDirWithSlash}`,
    `TUYỆT ĐỐI KHÔNG lưu vào ~/.claude/plans/ hay thư mục global khác.`,
    `Ưu tiên tên mô tả nội dung, ví dụ: refactor-auth-module.md, fix-payment-bug.md.`,
  );

  if (config.permissionMode === 'plan') {
    appendParts.push(
      `[PLAN MODE INSTRUCTIONS]`,
      `Bạn đang ở chế độ lập kế hoạch. Các quy tắc bắt buộc:`,
      `1. KHÔNG gọi EnterPlanMode hay ExitPlanMode. Chỉ phân tích bằng Read, Glob, Grep.`,
      `2. Được dùng tool Agent cho sub-agent nghiên cứu. Sub-agent không được chứa EnterPlanMode/ExitPlanMode.`,
      `3. Viết kế hoạch chi tiết dưới dạng Markdown.`,
      `4. PHẢI lưu file kế hoạch vào thư mục: ${projectPlansDirWithSlash}`,
      `5. KHÔNG được sửa bất kỳ file source code nào. Chỉ được TẠO/GHI file trong ${projectPlansDirWithSlash}`,
      `6. Kế hoạch phải bao gồm: Mục tiêu, Phân tích hiện trạng, Các bước thực hiện, và Rủi ro.`,
    );
  }

  if (config.systemPrompt) {
    appendParts.push(config.systemPrompt);
  }

  return appendParts;
}
