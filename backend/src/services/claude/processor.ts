import { v4 as uuidv4 } from 'uuid';
import { ChatMessage, ToolCall, ContentBlock, SubAgentActivity } from '../../types';
import { logger } from '../logger';
import { ClaudeSessionState } from './types';
import { EventEmitter } from 'events';

/**
 * SDK trả về kết quả Agent tool dưới dạng AgentOutput (structured JSON).
 * Dùng type này để parse thay vì regex thủ công.
 * Ref: https://platform.claude.com/docs/en/agent-sdk/typescript
 */
interface AgentOutput {
  status: 'completed' | 'async_launched' | 'sub_agent_entered';
  agentId?: string;
  content?: Array<{ type: string; text: string }>;
  totalToolUseCount?: number;
  totalDurationMs?: number;
  totalTokens?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
  prompt?: string;
  description?: string;
}

export class QueryProcessor {
  constructor(
    private sessionId: string,
    private state: ClaudeSessionState,
    private emitter: EventEmitter
  ) {}

  /**
   * Xử lý tool_result block.
   * parentToolUseId: nếu có → tool_result này nằm trong context sub-agent.
   *
   * Logic:
   * 1. Nếu tool_use_id khớp với một Agent/Task tool → sub-agent hoàn thành
   *    → Parse structured AgentOutput (không còn dùng regex)
   * 2. Nếu parentToolUseId có giá trị → tool_result nội bộ của sub-agent → chỉ track activity
   * 3. Còn lại → tool_result bình thường
   */
  public handleToolResult(block: any, ctx: any, parentToolUseId: string | null = null) {
    const matchId = block.tool_use_id;
    const resultContent = typeof block.content === 'string'
      ? block.content
      : JSON.stringify(block.content);

    // 1. Kiểm tra: tool_result của Agent tool (sub-agent hoàn thành)?
    if (matchId && ctx.subAgentNames.has(matchId)) {
      const agentName = ctx.subAgentNames.get(matchId) || 'Sub Agent';
      const activities = ctx.subAgentActivityMap.get(matchId) || [];
      logger.info(`[Claude][${this.sessionId}] Sub-agent "${agentName}" completed, activities: ${activities.length}`);

      // Parse structured AgentOutput — SDK trả JSON, không cần regex
      let agentOutput: AgentOutput | null = null;
      let displayResult = resultContent;
      let subAgentId: string | undefined;
      let subAgentUsage: { tokens: number; tools: number; durationMs: number } | undefined;

      try {
        agentOutput = JSON.parse(resultContent);
      } catch {
        // Fallback: kết quả không phải JSON (phiên bản SDK cũ hoặc lỗi)
        logger.debug(`[Claude][${this.sessionId}] Agent result is not JSON, using raw text`);
      }

      if (agentOutput && agentOutput.status === 'completed') {
        subAgentId = agentOutput.agentId;
        subAgentUsage = {
          tokens: agentOutput.totalTokens || 0,
          tools: agentOutput.totalToolUseCount || 0,
          durationMs: agentOutput.totalDurationMs || 0,
        };
        // Lấy text content từ structured output
        const textParts = (agentOutput.content || [])
          .filter(c => c.type === 'text')
          .map(c => c.text);
        displayResult = textParts.join('\n') || 'Nhiệm vụ đã hoàn thành.';
      }

      // Cập nhật tool_use block gốc với result
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

      // Thêm subagent_result block vào timeline
      ctx.turnBlocks.push({
        type: 'subagent_result',
        agentName,
        result: displayResult.length > 500 ? displayResult.slice(0, 500) + '...' : displayResult,
        isError: block.is_error,
        activities: [...activities],
        usage: subAgentUsage,
        agentId: subAgentId,
      });

      this.emitter.emit('subagent:ended', { sessionId: this.sessionId, agentName, isError: block.is_error });

      // Cleanup sub-agent tracking data
      ctx.subAgentNames.delete(matchId);
      ctx.subAgentActivityMap.delete(matchId);
      return;
    }

    // 2. Tool_result nội bộ của sub-agent? (parentToolUseId có giá trị)
    if (parentToolUseId && ctx.subAgentActivityMap.has(parentToolUseId)) {
      const activities = ctx.subAgentActivityMap.get(parentToolUseId) || [];
      // Gán result vào activity chưa có result (theo thứ tự)
      for (let i = 0; i < activities.length; i++) {
        if (!activities[i].result) {
          activities[i].result = resultContent.length > 200
            ? resultContent.slice(0, 200) + '...'
            : resultContent;
          activities[i].isError = block.is_error;
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
