import db from './db';
import type { ChatSession, ChatMessage } from '../types';

// Số tin nhắn tải mỗi lần cho phân trang
const DEFAULT_PAGE_SIZE = 5;

/**
 * Lấy toàn bộ sessions, sắp xếp theo updatedAt giảm dần.
 * Không trả kèm messages — frontend sẽ gọi riêng.
 */
export function getAllSessions(): (Omit<ChatSession, 'messages'> & { messageCount: number })[] {
  const rows = db.prepare(
    `SELECT s.id, s.project_id, s.session_id, s.name, s.is_active, s.total_cost, s.model, s.effort_level, s.permission_mode, s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count
     FROM sessions s ORDER BY s.updated_at DESC`
  ).all() as any[];

  return rows.map(rowToSession);
}

/**
 * Lấy sessions theo project ID.
 * - total_cost: COALESCE từ sessions.total_cost, fallback tính từ SUM(chat_messages.cost).
 * - total_tokens_input/output: luôn tính từ SUM(chat_messages) vì sessions table không có cột tokens.
 */
export function getSessionsByProject(projectId: string): (Omit<ChatSession, 'messages'> & { messageCount: number })[] {
  const rows = db.prepare(
    `SELECT s.id, s.project_id, s.session_id, s.name, s.is_active,
       COALESCE(s.total_cost, (SELECT SUM(m.cost) FROM chat_messages m WHERE m.session_id = s.id AND m.cost IS NOT NULL)) AS total_cost,
       (SELECT SUM(m.tokens_input) FROM chat_messages m WHERE m.session_id = s.id AND m.tokens_input IS NOT NULL) AS total_tokens_input,
       (SELECT SUM(m.tokens_output) FROM chat_messages m WHERE m.session_id = s.id AND m.tokens_output IS NOT NULL) AS total_tokens_output,
       s.model, s.effort_level, s.permission_mode, s.created_at, s.updated_at,
       (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS message_count
     FROM sessions s WHERE s.project_id = ? ORDER BY s.updated_at DESC`
  ).all(projectId) as any[];

  return rows.map(rowToSession);
}

/**
 * Lấy session theo ID.
 * Kèm theo messages (mặc định lấy gần nhất, dùng cho khởi tạo session).
 */
export function getSession(id: string): ChatSession | null {
  const row = db.prepare(
    'SELECT id, project_id, session_id, name, is_active, total_cost, model, effort_level, permission_mode, created_at, updated_at FROM sessions WHERE id = ?'
  ).get(id) as any;

  if (!row) return null;

  // Lấy toàn bộ messages khi load session (cho claude.ts dùng nội bộ)
  const messages = getAllMessages(id);

  return {
    ...rowToSession(row),
    messages,
  };
}

/**
 * Tạo session mới.
 */
export function createSession(session: Omit<ChatSession, 'messages'>): void {
  db.prepare(`
    INSERT INTO sessions (id, project_id, session_id, name, is_active, total_cost, model, effort_level, permission_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.projectId,
    session.sessionId,
    session.name ?? null,
    session.isActive ? 1 : 0,
    session.totalCost ?? null,
    session.model ?? null,
    session.effortLevel ?? null,
    session.permissionMode ?? null,
    session.createdAt,
    session.updatedAt,
  );
}

/**
 * Cập nhật metadata của session (không bao gồm messages).
 */
export function updateSession(id: string, data: Partial<Pick<ChatSession, 'name' | 'isActive' | 'totalCost' | 'model' | 'effortLevel' | 'permissionMode'>>): void {
  const now = new Date().toISOString();
  // Chỉ cập nhật các trường được truyền vào
  const sets: string[] = ['updated_at = ?'];
  const params: any[] = [now];

  if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
  if (data.isActive !== undefined) { sets.push('is_active = ?'); params.push(data.isActive ? 1 : 0); }
  if (data.totalCost !== undefined) { sets.push('total_cost = ?'); params.push(data.totalCost); }
  if (data.model !== undefined) { sets.push('model = ?'); params.push(data.model); }
  if (data.effortLevel !== undefined) { sets.push('effort_level = ?'); params.push(data.effortLevel); }
  if (data.permissionMode !== undefined) { sets.push('permission_mode = ?'); params.push(data.permissionMode); }

  params.push(id);
  db.prepare(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

/**
 * Lưu toàn bộ session (tương thích ngược với code cũ trong claude.ts).
 * Upsert session metadata + sync toàn bộ messages.
 */
export function saveSession(session: ChatSession): void {
  const now = new Date().toISOString();

  // Upsert session row
  db.prepare(`
    INSERT INTO sessions (id, project_id, session_id, name, is_active, total_cost, model, effort_level, permission_mode, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      is_active = excluded.is_active,
      total_cost = excluded.total_cost,
      model = excluded.model,
      effort_level = excluded.effort_level,
      permission_mode = excluded.permission_mode,
      updated_at = excluded.updated_at
  `).run(
    session.id,
    session.projectId,
    session.sessionId,
    session.name ?? null,
    session.isActive ? 1 : 0,
    session.totalCost ?? null,
    session.model ?? null,
    session.effortLevel ?? null,
    session.permissionMode ?? null,
    session.createdAt,
    now,
  );

  // Sync messages: chỉ insert những message chưa tồn tại
  const insertMsg = db.prepare(`
    INSERT OR IGNORE INTO chat_messages
      (id, session_id, role, content, blocks, tool_calls, model, cost, tokens_input, tokens_output, duration_ms, is_streaming, timestamp, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const existingCount = (db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE session_id = ?').get(session.id) as any).cnt;

  const syncAll = db.transaction(() => {
    for (let i = 0; i < session.messages.length; i++) {
      const msg = session.messages[i];
      insertMsg.run(
        msg.id,
        session.id,
        msg.role,
        msg.content,
        msg.blocks ? JSON.stringify(msg.blocks) : null,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.model ?? null,
        msg.cost ?? null,
        msg.tokens?.input ?? null,
        msg.tokens?.output ?? null,
        msg.durationMs ?? null,
        msg.isStreaming ? 1 : 0,
        msg.timestamp,
        existingCount + i, // sort_order tiếp nối từ messages hiện có
      );
    }
  });

  syncAll();
}

/**
 * Thêm 1 message vào session.
 * Dùng cho claude.ts khi nhận được message mới thay vì ghi lại toàn bộ.
 */
export function addMessage(sessionId: string, msg: ChatMessage): void {
  // Lấy sort_order tiếp theo
  const row = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM chat_messages WHERE session_id = ?'
  ).get(sessionId) as { next_order: number };

  db.prepare(`
    INSERT OR IGNORE INTO chat_messages
      (id, session_id, role, content, blocks, tool_calls, model, cost, tokens_input, tokens_output, duration_ms, is_streaming, timestamp, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.id,
    sessionId,
    msg.role,
    msg.content,
    msg.blocks ? JSON.stringify(msg.blocks) : null,
    msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
    msg.model ?? null,
    msg.cost ?? null,
    msg.tokens?.input ?? null,
    msg.tokens?.output ?? null,
    msg.durationMs ?? null,
    msg.isStreaming ? 1 : 0,
    msg.timestamp,
    row.next_order,
  );

  // Cập nhật updated_at của session
  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), sessionId);
}

/**
 * Cập nhật metadata (tokens/cost/duration/model) cho message đã tồn tại.
 */
export function updateMessageMeta(sessionId: string, msg: Pick<ChatMessage, 'id' | 'model' | 'cost' | 'durationMs' | 'tokens'>): void {
  db.prepare(`
    UPDATE chat_messages
    SET model = ?,
        cost = ?,
        tokens_input = ?,
        tokens_output = ?,
        duration_ms = ?
    WHERE session_id = ? AND id = ?
  `).run(
    msg.model ?? null,
    msg.cost ?? null,
    msg.tokens?.input ?? null,
    msg.tokens?.output ?? null,
    msg.durationMs ?? null,
    sessionId,
    msg.id,
  );

  db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), sessionId);
}

/**
 * Lấy toàn bộ messages của session (dùng nội bộ cho claude.ts).
 */
export function getAllMessages(sessionId: string): ChatMessage[] {
  const rows = db.prepare(
    'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sort_order ASC'
  ).all(sessionId) as any[];

  return rows.map(rowToMessage);
}

/**
 * Lấy messages phân trang — dùng cho API REST.
 * Trả về messages gần nhất (sort_order giảm dần), cursor-based pagination.
 * @param sessionId - ID session
 * @param cursor - sort_order tối đa (exclusive), không truyền = lấy mới nhất
 * @param limit - số lượng messages cần lấy
 * @returns { messages, nextCursor, hasMore }
 */
export function getMessagesPaginated(
  sessionId: string,
  cursor?: number,
  limit: number = DEFAULT_PAGE_SIZE,
): { messages: ChatMessage[]; nextCursor: number | null; hasMore: boolean } {
  let rows: any[];

  if (cursor !== undefined && cursor !== null) {
    // Lấy messages có sort_order < cursor (cũ hơn)
    rows = db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT ?'
    ).all(sessionId, cursor, limit + 1) as any[];
  } else {
    // Lấy messages mới nhất
    rows = db.prepare(
      'SELECT * FROM chat_messages WHERE session_id = ? ORDER BY sort_order DESC LIMIT ?'
    ).all(sessionId, limit + 1) as any[];
  }

  const hasMore = rows.length > limit;
  if (hasMore) rows.pop(); // Bỏ row thừa dùng để check hasMore

  // Đảo ngược lại để messages hiển thị đúng thứ tự thời gian (cũ → mới)
  rows.reverse();

  const messages = rows.map(rowToMessage);
  const nextCursor = hasMore && rows.length > 0 ? rows[0].sort_order : null;

  return { messages, nextCursor, hasMore };
}

/**
 * Xoá session và toàn bộ messages (cascade).
 */
export function deleteSession(id: string): boolean {
  const result = db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  return result.changes > 0;
}

/**
 * Đếm tổng số messages trong 1 session.
 */
export function getMessageCount(sessionId: string): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM chat_messages WHERE session_id = ?').get(sessionId) as any;
  return row.cnt;
}

// ============================================================
// Helpers chuyển đổi row SQLite → TypeScript interface
// ============================================================

function rowToSession(row: any): Omit<ChatSession, 'messages'> & { messageCount: number } {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    name: row.name ?? undefined,
    isActive: row.is_active === 1,
    totalCost: row.total_cost ?? undefined,
    totalInputTokens: row.total_tokens_input != null ? Number(row.total_tokens_input) : undefined,
    totalOutputTokens: row.total_tokens_output != null ? Number(row.total_tokens_output) : undefined,
    model: row.model ?? undefined,
    effortLevel: row.effort_level ?? undefined,
    permissionMode: row.permission_mode ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? 0,
  };
}

function rowToMessage(row: any): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    blocks: row.blocks ? JSON.parse(row.blocks) : undefined,
    toolCalls: row.tool_calls ? JSON.parse(row.tool_calls) : undefined,
    model: row.model ?? undefined,
    cost: row.cost ?? undefined,
    tokens: row.tokens_input != null ? { input: row.tokens_input, output: row.tokens_output } : undefined,
    durationMs: row.duration_ms ?? undefined,
    isStreaming: row.is_streaming === 1 ? true : undefined,
    timestamp: row.timestamp,
  };
}
