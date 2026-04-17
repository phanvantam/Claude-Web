/**
 * Quản lý sub-agent data: listing, timeline retrieval.
 *
 * Tách từ ClaudeService class — chứa các phương thức liên quan đến
 * truy vấn dữ liệu sub-agent từ DB và filesystem.
 * Không bind vào class — nhận dependencies qua parameter.
 */

import { ChatMessage } from '../../types';
import { getProject } from '../project';
import { getSession, getAllMessages } from '../session';
import { logger } from '../logger';
import * as utils from './utils';
import { ClaudeSessionState } from './types';

/**
 * Lấy danh sách sub-agents cho session.
 * Ưu tiên: DB subagent_result blocks → filesystem .meta.json
 * Không đoán tên — nếu thiếu agentName thì đó là lỗi dữ liệu.
 */
export function listSubAgents(
  sessionId: string,
  sessions: Map<string, ClaudeSessionState>,
): any[] {
  // Ưu tiên 1: DB — subagent_result blocks chứa agentName chính xác
  const dbAgents = listSubAgentsFromDB(sessionId);
  if (dbAgents.length > 0) return dbAgents;

  // Ưu tiên 2: Filesystem (.meta.json) — cho CLI sessions chưa lưu DB
  const cwd = resolveSessionCwd(sessionId, sessions);
  if (!cwd) return [];
  return utils.listSubAgents(sessionId, cwd);
}

/**
 * Lấy timeline events của một sub-agent.
 * DB first (activities trong subagent_result block) → filesystem second.
 */
export function getSubAgentTimeline(
  sessionId: string,
  agentId: string,
  sessions: Map<string, ClaudeSessionState>,
): any[] {
  // Thử đọc từ DB trước
  const dbTimeline = getSubAgentTimelineFromDB(sessionId, agentId);
  if (dbTimeline.length > 0) return dbTimeline;

  // Fallback: filesystem (CLI sessions)
  const cwd = resolveSessionCwd(sessionId, sessions);
  if (!cwd) return [];
  return utils.getSubAgentTimeline(sessionId, agentId, cwd);
}

// ─── Internal helpers ─────────────────────────────────────────────────────

/**
 * Trích danh sách sub-agents từ subagent_result blocks trong DB.
 * Nguồn chính xác nhất — agentName được gán trực tiếp từ tool_use input
 * tại thời điểm SDK stream xử lý (sdkRunner → processor).
 */
function listSubAgentsFromDB(sessionId: string): any[] {
  try {
    const messages: ChatMessage[] = getAllMessages(sessionId);
    const agents: any[] = [];
    const seen = new Set<string>();

    for (const msg of messages) {
      if (!msg.blocks) continue;
      for (const block of msg.blocks) {
        if ((block as any).type !== 'subagent_result') continue;
        const b = block as any;

        // agentId có thể null ở subagent_result cũ — tạo key duy nhất
        const agentId = b.agentId || `agent-${seen.size}`;
        if (seen.has(agentId)) continue;
        seen.add(agentId);

        agents.push({
          agentId,
          agentType: b.agentName, // Tên chính xác, KHÔNG fallback
          description: extractResultText(b.result),
          messageCount: b.activities?.length || 0,
          startedAt: msg.timestamp,
        });
      }
    }

    return agents;
  } catch (err) {
    logger.error(`[SubAgentManager] listSubAgentsFromDB error:`, err);
    return [];
  }
}

/**
 * Trích text thuần từ result field của subagent_result block.
 * Result có thể là JSON stringified array hoặc plain text.
 */
function extractResultText(result: any): string {
  if (!result) return '';
  const raw = typeof result === 'string' ? result : JSON.stringify(result);

  // Thử parse JSON array hoàn chỉnh
  if (raw.trimStart().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const texts = parsed
          .filter((b: any) => b.type === 'text' && b.text)
          .map((b: any) => (b.text as string).trim())
          .filter(Boolean);
        if (texts.length > 0) {
          // Strip metadata agentId/usage mà processor có thể lưu lẫn vào text
          const cleaned = texts
            .join(' ')
            .replace(/agentId:\s*\S+\s*\([^)]*\)/gi, '')
            .replace(/<usage>[\s\S]*?<\/usage>/gi, '')
            .replace(/\n/g, ' ')
            .trim();
          return cleaned.trim();
        }
      }
    } catch { /* JSON truncate — dùng indexOf */ }

    // JSON bị cắt giữa chừng: tìm "text":"..." và lấy nội dung sau
    const KEY = '"text":"';
    const start = raw.indexOf(KEY);
    if (start !== -1) {
      // Lấy phần sau "text":"
      let content = raw.slice(start + KEY.length);
      // Tìm closing quote (nếu còn), nếu không thì lấy hết
      const endQ = content.search(/(?<!\\)"/);
      if (endQ !== -1) content = content.slice(0, endQ);
      return content
        .replace(/\\n/g, ' ')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, ' ')
        .replace(/\.\.\.$/g, '')
        .trim();
    }
  }

  // Plain text: strip metadata agentId/usage do processor lưu vào
  const stripped = raw
    .replace(/agentId:[\s\S]*?\(for resuming[^)]*\)/gi, '')
    .replace(/<usage>[\s\S]*?<\/usage>/gi, '')
    .trim();

  return stripped.replace(/\n/g, ' ').trim();
}

/**
 * Lấy timeline từ activities trong subagent_result block (DB).
 * Mỗi activity là một tool_use mà sub-agent đã thực hiện.
 */
function getSubAgentTimelineFromDB(sessionId: string, agentId: string): any[] {
  try {
    const messages: ChatMessage[] = getAllMessages(sessionId);

    for (const msg of messages) {
      if (!msg.blocks) continue;
      for (const block of msg.blocks) {
        if ((block as any).type !== 'subagent_result') continue;
        const b = block as any;
        const blockId = b.agentId || null;

        // Match agentId: chấp nhận prefix match (agent-0 vs null là entry đầu tiên không có agentId)
        const isMatch = blockId === agentId
          || (!blockId && agentId.startsWith('agent-'));

        if (!isMatch) continue;

        const activities: any[] = b.activities || [];
        if (activities.length === 0) return [];

        // Chuyển activities → SubAgentTimelineEvent format
        const events: any[] = [];
        for (const act of activities) {
          events.push({
            type: 'tool_use',
            content: JSON.stringify({ name: act.name, input: act.input }, null, 2),
            toolName: act.name,
            timestamp: msg.timestamp,
          });
          if (act.result !== undefined) {
            events.push({
              type: 'tool_result',
              content: typeof act.result === 'string'
                ? act.result
                : JSON.stringify(act.result),
              isError: !!act.isError,
              timestamp: msg.timestamp,
            });
          }
        }

        // Thêm event kết quả cuối nếu có
        if (b.result) {
          events.push({
            type: 'text',
            content: extractResultText(b.result),
            timestamp: msg.timestamp,
          });
        }

        return events;
      }
    }
    return [];
  } catch (err) {
    logger.error(`[SubAgentManager] getSubAgentTimelineFromDB error:`, err);
    return [];
  }
}

/**
 * Resolve cwd (project path) cho sessionId.
 * Thứ tự ưu tiên:
 * 1. Session active trong memory → lấy projectId → project.path
 * 2. Session lưu trong DB → lấy projectId → project.path
 * 3. Scan ~/.claude/projects/ tìm folder chứa session .jsonl
 */
function resolveSessionCwd(
  sessionId: string,
  sessions: Map<string, ClaudeSessionState>,
): string | null {
  // 1. Active session
  const state = sessions.get(sessionId);
  if (state?.projectId) {
    const project = getProject(state.projectId);
    if (project) return project.path;
  }

  // 2. Saved session trong DB
  const saved = getSession(sessionId);
  if (saved?.projectId) {
    const project = getProject(saved.projectId);
    if (project) return project.path;
  }

  // 3. Scan filesystem — tìm project dir chứa session file
  return utils.findSessionCwd(sessionId);
}
