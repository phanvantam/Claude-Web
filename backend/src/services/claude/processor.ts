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

    const extractAgentId = (text: string): string | undefined => {
      const match = text.match(/agentId:\s*([a-zA-Z0-9_-]+)/i);
      return match?.[1];
    };

    const extractUsage = (text: string): { tokens: number; tools: number; durationMs: number } | undefined => {
      const usageMatch = text.match(/<usage>([\s\S]*?)<\/usage>/i);
      if (!usageMatch || !usageMatch[1]) return undefined;

      const usageText = usageMatch[1];
      const tokens = Number(usageText.match(/total_tokens:\s*(\d+)/i)?.[1] || 0);
      const tools = Number(usageText.match(/tool_uses:\s*(\d+)/i)?.[1] || 0);
      const durationMs = Number(usageText.match(/duration_ms:\s*(\d+)/i)?.[1] || 0);

      if (tokens === 0 && tools === 0 && durationMs === 0) return undefined;
      return { tokens, tools, durationMs };
    };

    const stripMetadata = (text: string): string => text
      .replace(/agentId:\s*[a-zA-Z0-9_-]+\s*(\([^)]*\))?/gi, '')
      .replace(/<usage>[\s\S]*?<\/usage>/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const extractTextBlocks = (value: unknown): string[] => {
      if (!Array.isArray(value)) return [];
      return value
        .filter((item): item is { type: string; text: string } => (
          typeof item === 'object' &&
          item !== null &&
          (item as { type?: unknown }).type === 'text' &&
          typeof (item as { text?: unknown }).text === 'string'
        ))
        .map((item) => item.text.trim())
        .filter(Boolean);
    };

    // 1. Kiểm tra: tool_result của Agent tool (sub-agent hoàn thành)?
    if (matchId && ctx.subAgentNames.has(matchId)) {
      const agentName = ctx.subAgentNames.get(matchId) || 'Sub Agent';
      const activities = ctx.subAgentActivityMap.get(matchId) || [];
      logger.info(`[Claude][${this.sessionId}] Sub-agent "${agentName}" completed, activities: ${activities.length}`);

      let displayResult = resultContent;
      let subAgentId: string | undefined;
      let subAgentUsage: { tokens: number; tools: number; durationMs: number } | undefined;
      let parsedResult: unknown;

      try {
        parsedResult = JSON.parse(resultContent);
      } catch {
        logger.debug(`[Claude][${this.sessionId}] Agent result is not JSON, using raw text`);
      }

      if (parsedResult && typeof parsedResult === 'object' && !Array.isArray(parsedResult)) {
        const agentOutput = parsedResult as AgentOutput;

        if (agentOutput.agentId) {
          subAgentId = agentOutput.agentId;
        }

        const tokensFromUsage = (agentOutput.usage?.input_tokens || 0) + (agentOutput.usage?.output_tokens || 0);
        const tokens = agentOutput.totalTokens || tokensFromUsage;
        const tools = agentOutput.totalToolUseCount || 0;
        const durationMs = agentOutput.totalDurationMs || 0;
        if (tokens > 0 || tools > 0 || durationMs > 0) {
          subAgentUsage = { tokens, tools, durationMs };
        }

        const textParts = extractTextBlocks(agentOutput.content || []);
        if (textParts.length > 0) {
          displayResult = textParts.join('\n');
        }
      } else {
        const textParts = extractTextBlocks(parsedResult);
        if (textParts.length > 0) {
          displayResult = textParts.join('\n');
        }
      }

      if (!subAgentId) {
        subAgentId = extractAgentId(resultContent) || extractAgentId(displayResult);
      }

      if (!subAgentUsage) {
        subAgentUsage = extractUsage(resultContent) || extractUsage(displayResult);
      }

      displayResult = stripMetadata(displayResult);
      if (!displayResult) {
        displayResult = stripMetadata(resultContent);
      }
      if (!displayResult) {
        displayResult = 'Nhiệm vụ đã hoàn thành.';
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

      // Cập nhật hoặc thêm subagent_result block vào timeline
      const existingSubAgentResultIndex = ctx.turnBlocks.findIndex((b: ContentBlock) =>
        b.type === 'subagent_result' && (b as any).parentToolUseId === matchId,
      );

      const subAgentResultBlock: ContentBlock = {
        type: 'subagent_result',
        agentName,
        result: displayResult,
        isError: block.is_error,
        activities: [...activities],
        usage: subAgentUsage,
        agentId: subAgentId,
        parentToolUseId: matchId,
      };

      if (existingSubAgentResultIndex >= 0) {
        ctx.turnBlocks[existingSubAgentResultIndex] = subAgentResultBlock;
      } else {
        ctx.turnBlocks.push(subAgentResultBlock);
      }

      this.emitter.emit('subagent:ended', { sessionId: this.sessionId, agentName, isError: block.is_error });

      // Cleanup sub-agent tracking data
      ctx.subAgentNames.delete(matchId);
      ctx.subAgentActivityMap.delete(matchId);
      if (ctx.subAgentLiveTextMap) {
        ctx.subAgentLiveTextMap.delete(matchId);
      }
      if (ctx.subAgentStreamEventParents) {
        ctx.subAgentStreamEventParents.delete(matchId);
      }
      return;
    }

    // 2. Tool_result nội bộ của sub-agent? (parentToolUseId có giá trị)
    if (parentToolUseId && ctx.subAgentActivityMap.has(parentToolUseId)) {
      const activities = ctx.subAgentActivityMap.get(parentToolUseId) || [];
      const toolId = typeof block.tool_use_id === 'string' ? block.tool_use_id : undefined;

      // Ưu tiên map chính xác theo toolId để tránh lệch result khi sub-agent gọi nhiều tool nhanh.
      if (toolId) {
        const byId = activities.find((a: any) => a.toolId === toolId);
        if (byId) {
          byId.result = resultContent;
          byId.isError = block.is_error;
          return;
        }
      }

      // Fallback cho data cũ không có toolId: gán theo activity chưa có result.
      for (let i = 0; i < activities.length; i++) {
        if (!activities[i].result) {
          activities[i].result = resultContent;
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
