import type { ChatSession, ChatMessage } from '../types';
/**
 * Lấy toàn bộ sessions, sắp xếp theo updatedAt giảm dần.
 * Không trả kèm messages — frontend sẽ gọi riêng.
 */
export declare function getAllSessions(): (Omit<ChatSession, 'messages'> & {
    messageCount: number;
})[];
/**
 * Lấy sessions theo project ID.
 */
export declare function getSessionsByProject(projectId: string): (Omit<ChatSession, 'messages'> & {
    messageCount: number;
})[];
/**
 * Lấy session theo ID.
 * Kèm theo messages (mặc định lấy gần nhất, dùng cho khởi tạo session).
 */
export declare function getSession(id: string): ChatSession | null;
/**
 * Tạo session mới.
 */
export declare function createSession(session: Omit<ChatSession, 'messages'>): void;
/**
 * Cập nhật metadata của session (không bao gồm messages).
 */
export declare function updateSession(id: string, data: Partial<Pick<ChatSession, 'name' | 'isActive' | 'totalCost' | 'model' | 'effortLevel' | 'permissionMode'>>): void;
/**
 * Lưu toàn bộ session (tương thích ngược với code cũ trong claude.ts).
 * Upsert session metadata + sync toàn bộ messages.
 */
export declare function saveSession(session: ChatSession): void;
/**
 * Thêm 1 message vào session.
 * Dùng cho claude.ts khi nhận được message mới thay vì ghi lại toàn bộ.
 */
export declare function addMessage(sessionId: string, msg: ChatMessage): void;
/**
 * Cập nhật metadata (tokens/cost/duration/model) cho message đã tồn tại.
 */
export declare function updateMessageMeta(sessionId: string, msg: Pick<ChatMessage, 'id' | 'model' | 'cost' | 'durationMs' | 'tokens'>): void;
/**
 * Lấy toàn bộ messages của session (dùng nội bộ cho claude.ts).
 */
export declare function getAllMessages(sessionId: string): ChatMessage[];
/**
 * Lấy messages phân trang — dùng cho API REST.
 * Trả về messages gần nhất (sort_order giảm dần), cursor-based pagination.
 * @param sessionId - ID session
 * @param cursor - sort_order tối đa (exclusive), không truyền = lấy mới nhất
 * @param limit - số lượng messages cần lấy
 * @returns { messages, nextCursor, hasMore }
 */
export declare function getMessagesPaginated(sessionId: string, cursor?: number, limit?: number): {
    messages: ChatMessage[];
    nextCursor: number | null;
    hasMore: boolean;
};
/**
 * Xoá session và toàn bộ messages (cascade).
 */
export declare function deleteSession(id: string): boolean;
/**
 * Đếm tổng số messages trong 1 session.
 */
export declare function getMessageCount(sessionId: string): number;
//# sourceMappingURL=session.d.ts.map