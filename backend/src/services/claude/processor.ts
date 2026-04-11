import { v4 as uuidv4 } from 'uuid';
import { ChatMessage, ToolCall, ContentBlock, SubAgentActivity } from '../../types';
import { logger } from '../logger';
import { ClaudeSessionState } from './types';
import { EventEmitter } from 'events';

export class QueryProcessor {
  constructor(
    private sessionId: string,
    private state: ClaudeSessionState,
    private emitter: EventEmitter
  ) {}

  public handleToolResult(block: any, ctx: any) {
    const matchId = block.tool_use_id;
    const resultContent = typeof block.content === 'string'
      ? block.content
      : JSON.stringify(block.content);

    // 1. Kiểm tra: đây có phải tool_result của Task (sub-agent) không?
    if (matchId && matchId === ctx.activeTaskToolId) {
      logger.info(`[Claude][${this.sessionId}] ✅ Sub-agent Task completed, activities: ${ctx.subAgentActivities.length}`);

      // Logic parse kỹ thuật chuyên sâu (giữ nguyên)
      const agentIdMatch = resultContent.match(/agentId:\s+([a-z0-9]+)/i);
      const usageMatch = resultContent.match(/<usage>([\s\S]*?)<\/usage>/);
      
      let subAgentUsage = undefined;
      let subAgentId = agentIdMatch ? agentIdMatch[1] : undefined;
      let displayResult = resultContent;

      if (usageMatch) {
        const usageStr = usageMatch[1];
        subAgentUsage = {
          tokens: parseInt(usageStr.match(/total_tokens:\s+(\d+)/)?.[1] || '0'),
          tools: parseInt(usageStr.match(/tool_uses:\s+(\d+)/)?.[1] || '0'),
          durationMs: parseInt(usageStr.match(/duration_ms:\s+(\d+)/)?.[1] || '0'),
        };
        const stripped = resultContent
          .replace(/agentId:[\s\S]*?\(for resuming to continue this agent's work if needed\)/i, '')
          .replace(/<usage>[\s\S]*?<\/usage>/, '')
          .trim();
        displayResult = stripped || "Nhiệm vụ đã hoàn thành.";
      }

      for (let i = ctx.turnBlocks.length - 1; i >= 0; i--) {
        const b = ctx.turnBlocks[i];
        if (b.type === 'tool_use' && b.tool.id === matchId) {
          b.tool.result = resultContent;
          b.tool.isError = block.is_error;
          break;
        }
      }
      const tc = ctx.turnToolCalls.find((t: ToolCall) => t.id === matchId);
      if (tc) { tc.result = resultContent; tc.isError = block.is_error; }

      ctx.turnBlocks.push({
        type: 'subagent_result',
        agentName: ctx.activeTaskAgentName,
        result: displayResult.length > 500 ? displayResult.slice(0, 500) + '...' : displayResult,
        isError: block.is_error,
        activities: [...ctx.subAgentActivities],
        usage: subAgentUsage,
        agentId: subAgentId,
      });

      this.emitter.emit('subagent:ended', { sessionId: this.sessionId, agentName: ctx.activeTaskAgentName, isError: block.is_error });
      ctx.activeTaskToolId = null;
      ctx.activeTaskAgentName = '';
      ctx.subAgentActivities.length = 0;
      return;
    }

    // 2. Kiểm tra: tool_result thuộc sub-agent activity?
    if (ctx.activeTaskToolId) {
      for (let i = 0; i < ctx.subAgentActivities.length; i++) {
        if (!ctx.subAgentActivities[i].result) {
          ctx.subAgentActivities[i].result = resultContent.length > 200
            ? resultContent.slice(0, 200) + '...'
            : resultContent;
          ctx.subAgentActivities[i].isError = block.is_error;
          break;
        }
      }
      return;
    }

    // 3. Tool_result bình thường — match trong turnBlocks
    for (let i = ctx.turnBlocks.length - 1; i >= 0; i--) {
      const b = ctx.turnBlocks[i];
      if (b.type === 'tool_use' && (matchId ? b.tool.id === matchId : true)) {
        b.tool.result = resultContent;
        b.tool.isError = block.is_error;
        break;
      }
    }
    const tc2 = matchId
      ? ctx.turnToolCalls.find((t: ToolCall) => t.id === matchId)
      : ctx.turnToolCalls[ctx.turnToolCalls.length - 1];
    if (tc2) { tc2.result = resultContent; tc2.isError = block.is_error; }
  }
}
