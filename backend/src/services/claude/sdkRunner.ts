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
import {
  isAbortRequested,
  shouldIgnoreEventAfterInterrupt,
  createWatchdogController,
  createTokenController,
} from './sdkRunner/runtimeControl';
import {
  buildCanUseToolHandler,
  buildSystemPromptAppend,
} from './sdkRunner/permissionPolicy';
import {
  handleSystemEvent,
  handleStreamEvent,
  handleUserEvent,
} from './sdkRunner/streamEvents';

// BUILD: 2026-04-16-v7 — refactor split + token wiring clean + task_progress debounce
const SDK_RUNNER_BUILD = '2026-04-16-v7';
let hasLoggedSdkRunnerBuild = false;
const LINUX_HIDDEN_COMPLETION_TOKEN = '__CLAUDE_SESSION_END__';
const ENABLE_CLAUDE_SESSION_END = ['1', 'true', 'yes', 'on'].includes(
  (process.env.ENABLE_CLAUDE_SESSION_END ?? 'true').trim().toLowerCase(),
);

export async function runSDKQuery(
  sessionId: string,
  message: string,
  config: SDKQueryConfig,
  state: ClaudeSessionState,
  emitter: EventEmitter,
): Promise<void> {
  if (!hasLoggedSdkRunnerBuild) {
    logger.info(`[Claude] SDK RUNNER BUILD: ${SDK_RUNNER_BUILD}`);
    hasLoggedSdkRunnerBuild = true;
  }

  const sdk = await utils.getSDK();

  const isResume = utils.hasCliSession(sessionId, config.cwd);
  logger.info(`[Claude] Session ${sessionId}: cliSessionExists=${isResume}, strategy=${isResume ? 'resume' : 'new'}`);

  const abortController = new AbortController();
  state.abortController = abortController;
  state.linuxCompletionTokenDetected = undefined;

  // ── SDK options ──────────────────────────────────────────────────────────
  const options: Record<string, any> = {
    cwd: config.cwd,
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project', 'user', 'local'],
  };

  // allowedTools: MCP tools
  try {
    const mcpData = getMcpServersDetailed(config.cwd);
    const mergedMcp = { ...mcpData.global, ...mcpData.project };
    if (Object.keys(mergedMcp).length > 0) {
      options.allowedTools = Object.keys(mergedMcp).map(name => `mcp__${name}__*`);
      logger.info(`[Claude][${sessionId}] MCP allowedTools: ${options.allowedTools.join(', ')}`);
    }
  } catch (err) {
    logger.warn(`[Claude][${sessionId}] Failed to build MCP allowedTools:`, err);
  }

  if (isResume) {
    options.resume = sessionId;
    logger.info(`[Claude][${sessionId}] Resuming — SDK reads mcpServers from settings`);
  } else {
    options.sessionId = sessionId;

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

    try {
      const agentDefs = buildSDKAgentDefinitions(config.cwd);
      if (Object.keys(agentDefs).length > 0) {
        options.agents = agentDefs;
        logger.info(`[Claude][${sessionId}] Injected ${Object.keys(agentDefs).length} agent definitions`);
      }
    } catch (err) {
      logger.warn(`[Claude][${sessionId}] Failed to load agent definitions:`, err);
    }
  }

  if (config.model) options.model = config.model;
  options.permissionMode = config.permissionMode || 'default';

  // canUseTool: delegate sang permissionPolicy module
  const permissionMode = options.permissionMode as string;
  options.canUseTool = buildCanUseToolHandler({ sessionId, state, emitter, config, permissionMode });

  // SDK-level options
  if (config.effortLevel) options.effort = config.effortLevel;
  if (config.maxTurns) options.maxTurns = config.maxTurns;
  if (config.maxBudgetUsd) options.maxBudgetUsd = config.maxBudgetUsd;

  // systemPrompt append: plan enforcement + mode instructions
  const projectPlansDir = path.resolve(config.cwd, '.claude', 'plans');
  const projectPlansDirWithSlash = `${projectPlansDir}/`;
  const appendParts = buildSystemPromptAppend(config, projectPlansDirWithSlash);
  if (appendParts.length > 0) {
    options.systemPrompt = { type: 'preset', preset: 'claude_code', append: appendParts.join('\n') };
  }

  // Completion token
  const completionTokenUserInstruction = [
    '[SESSION END KEY REQUIREMENT]',
    `When you have fully completed your final answer, you MUST print this exact key at the VERY END of your response: ${LINUX_HIDDEN_COMPLETION_TOKEN}`,
    'Do not wrap this key in backticks/markdown, and do not output any characters after the key.',
  ].join('\n');
  const effectivePrompt = ENABLE_CLAUDE_SESSION_END
    ? `${message}\n\n${completionTokenUserInstruction}`
    : message;

  logger.info(`[sdkRunner] Options: sessionId=${sessionId}, model=${options.model}, appendLen=${(options.systemPrompt as any).append?.length || 0}`);

  // Features
  options.agentProgressSummaries = true;
  options.promptSuggestions = true;
  options.includePartialMessages = true;

  // Env patch
  const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
  process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

  // Periodic save
  const saveInterval = setInterval(() => {
    try {
      if (state.messages.length > 0) {
        const lastMsg = state.messages[state.messages.length - 1];
        if (lastMsg.role === 'assistant') persistMessage(sessionId, lastMsg);
      }
    } catch (err) {
      logger.warn(`[Claude][${sessionId}] Periodic save failed:`, err);
    }
  }, 5000);

  // Watchdog
  const watchdog = createWatchdogController({
    sessionId,
    state,
    onTimeout: async (reason: string) => {
      logger.warn(`[Claude][${sessionId}] Watchdog: ${reason}`);
      const qi = state.queryInstance;
      if (qi) {
        try { await qi.interrupt(); } catch {}
      }
    },
  });
  watchdog.reset();

  // Token controller
  const tokenCtrl = createTokenController(
    sessionId,
    state,
    (_source: 'stream_event' | 'assistant') => {},
    ENABLE_CLAUDE_SESSION_END,
  );

  // Turn context
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
    subAgentActivityMap: new Map(),
    subAgentNames: new Map(),
    activeStreamBlock: null,
    hasReceivedStreamEvents: false,
  };

  const startTime = Date.now();
  const getElapsed = () => `${Date.now() - startTime}ms`;

  const clearPartialTurnInState = () => {
    state.partialAssistantBlocks = undefined;
    state.partialToolCalls = undefined;
    state.partialAssistantContent = undefined;
  };

  let lastTaskProgressSnapshot = {
    blocksCount: -1,
    toolsCount: -1,
    contentLength: -1,
  };

  // MCP init pending flag
  let mcpInitPending = false;
  const setMcpInitPending = (v: boolean) => { mcpInitPending = v; };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let queryInstance: any = null;

  try {
    const claudeBinary = utils.getClaudeBinary();
    logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] Starting sdk.query`);
    logger.info(`[Claude][${sessionId}] Binary: ${claudeBinary}, permissionMode: ${options.permissionMode}, promptLength: ${effectivePrompt.length}`);

    queryInstance = sdk.query({
      prompt: effectivePrompt,
      options,
      pathToClaudeCodeExecutable: claudeBinary,
    });

    state.queryInstance = queryInstance;

    // Early abort check
    if (isAbortRequested(state)) {
      logger.info(`[Claude][${sessionId}] Early abort requested before loop start`);
      try { await queryInstance.interrupt(); } catch {}
    }

    logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] sdk.query initiated, starting for-await loop`);

    for await (const sdkMsg of queryInstance) {
      const type = sdkMsg.type as string;
      logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] SDK Event: ${type}`);

      if (shouldIgnoreEventAfterInterrupt(state, type)) {
        logger.debug(`[Claude][${sessionId}] Ignore ${type} after interrupt reason=${state.interruptReason}`);
        continue;
      }

      watchdog.reset();

      // MCP init resolved on next non-system event
      if (mcpInitPending && type !== 'system') {
        mcpInitPending = false;
        emitter.emit('mcp:resolved', { sessionId });
      }

      switch (type) {
        case 'system': {
          handleSystemEvent({
            sessionId,
            state,
            emitter,
            sdkMsg,
            getElapsed,
            setMcpInitPending,
          });
          break;
        }

        case 'stream_event': {
          handleStreamEvent({
            sessionId,
            state,
            emitter,
            sdkMsg,
            ctx,
            processor,
            hasLinuxCompletionToken: (text) => tokenCtrl.checkText(text),
            hasLinuxCompletionTokenAcrossStreamChunks: (chunk) => tokenCtrl.checkStreamChunk(chunk),
            interruptForLinuxCompletion: (source) => {
              tokenCtrl.scheduleInterrupt(source);
            },
          });
          break;
        }

        case 'assistant': {
          const parentToolUseId = (sdkMsg as any).parent_tool_use_id || null;
          if (!parentToolUseId) {
            const apiMsg = (sdkMsg as any).message;
            if (apiMsg?.content && Array.isArray(apiMsg.content)) {
              for (const block of apiMsg.content) {
                if (block.type === 'text' && typeof block.text === 'string' && tokenCtrl.checkText(block.text)) {
                  tokenCtrl.scheduleInterrupt('assistant');
                }
              }
            }
          }
          ctx.activeStreamBlock = null;
          handleAssistantEvent(sdkMsg, sessionId, state, emitter, processor, ctx, parentToolUseId);
          break;
        }

        case 'user': {
          handleUserEvent(sessionId, sdkMsg, processor, ctx, state, emitter);
          break;
        }

        case 'result': {
          watchdog.clear();
          logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] Final result event received`);
          handleResultEvent(sdkMsg, sessionId, state, emitter, ctx, queryInstance);
          break;
        }

        default: {
          if (type === 'task_progress') {
            if (state.activeSubAgent) {
              state.activeSubAgent = { ...state.activeSubAgent, lastHeartbeat: Date.now() };
              // Chỉ snapshot khi nội dung thay đổi thật sự
              const bc = ctx.turnBlocks.length;
              const tc = ctx.turnToolCalls.length;
              const cl = ctx.turnTextParts.join('').length;
              if (bc !== lastTaskProgressSnapshot.blocksCount ||
                  tc !== lastTaskProgressSnapshot.toolsCount ||
                  cl !== lastTaskProgressSnapshot.contentLength) {
                lastTaskProgressSnapshot = { blocksCount: bc, toolsCount: tc, contentLength: cl };
                state.partialAssistantBlocks = [...ctx.turnBlocks];
                state.partialToolCalls = [...ctx.turnToolCalls];
                state.partialAssistantContent = ctx.turnTextParts.join('');
              }
            }
            emitter.emit('task:progress', {
              sessionId,
              taskId: (sdkMsg as any).task_id,
              summary: (sdkMsg as any).summary,
            });
          } else if (type === 'prompt_suggestion') {
            emitter.emit('prompt:suggestion', {
              sessionId,
              suggestion: (sdkMsg as any).suggestion,
            });
          } else if (type === 'rate_limit_event') {
            logger.warn(`[Claude][${sessionId}] Rate limit:`, (sdkMsg as any).rate_limit_info);
            emitter.emit('rate:limit', { sessionId, info: (sdkMsg as any).rate_limit_info });
          } else {
            emitter.emit('raw', { sessionId, event: sdkMsg });
          }
          break;
        }
      }
    }
    logger.info(`[Claude][${sessionId}] [T+${getElapsed()}] for-await loop finished naturally`);
  } catch (err: any) {
    const errMsg = err.message || String(err);
    const isAbortError = err.name === 'AbortError' || abortController.signal.aborted || errMsg.includes('Request was aborted');
    const isEdeDiagnostic = errMsg.includes('[ede_diagnostic]') && (errMsg.includes('stop_reason=tool_use') || errMsg.includes('stop_reason=null'));

    if (isAbortError) {
      logger.info(`[Claude] Query aborted for ${sessionId}`);
    } else if (isEdeDiagnostic) {
      logger.warn(`[Claude][${sessionId}] SDK ede_diagnostic after result handling — expected, ignoring`);
    } else {
      throw err;
    }
  } finally {
    // Restore env
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }

    // Cleanup
    watchdog.clear();
    tokenCtrl.clear();
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