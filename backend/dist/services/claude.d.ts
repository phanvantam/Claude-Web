import { EventEmitter } from 'events';
import type { ChatMessage } from '../types';
declare class ClaudeService extends EventEmitter {
    private sessions;
    getSessionState(sessionId: string): {
        messages: ChatMessage[];
        isProcessing: boolean;
        model?: string;
        effortLevel?: string;
        permissionMode?: string;
        pendingPermission?: any;
    } | null;
    /**
     * Cập nhật effort level cho một session đang active hoặc đã lưu.
     */
    setSessionEffortLevel(sessionId: string, effortLevel?: string): void;
    /**
     * Lấy effort level hiện tại của session.
     */
    getSessionEffortLevel(sessionId: string): string | undefined;
    /**
     * Cập nhật permission mode cho một session đang active hoặc đã lưu.
     */
    setSessionPermissionMode(sessionId: string, permissionMode?: string): void;
    /**
     * Lấy permission mode hiện tại của session.
     */
    getSessionPermissionMode(sessionId: string): string | undefined;
    /**
     * Kiểm tra xem Claude CLI có file conversation cho session này không.
     * CLI lưu tại: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
     * Đường dẫn cwd được encode: '/' → '-', bỏ trailing slash.
     */
    private hasCliSession;
    /**
     * Thêm 1 message vào CSDL.
     */
    private persistMessage;
    /**
     * Khởi tạo hoặc attach vào một session.
     * Nếu session đã có trong memory → trả lại luôn.
     * Nếu có trong DB → load messages.
     * Nếu chưa có → tạo mới trong DB.
     */
    startSession(projectId: string, existingSessionId?: string, effortLevel?: string): Promise<string>;
    /**
     * Gửi message tới Claude SDK.
     * SDK tự spawn CLI process, xử lý stdin/stdout, và trả về AsyncGenerator<SDKMessage>.
     */
    sendMessage(sessionId: string, message: string): void;
    /**
     * Chạy SDK query() và xử lý stream messages.
     * Đây là core logic — thay thế toàn bộ spawnClaudeProcess + handleOutput + processStreamEvent cũ.
     */
    private runSDKQuery;
    /**
     * Xử lý phản hồi permission từ user (qua WebSocket).
     * Gọi khi user chọn Allow hoặc Deny trên UI.
     */
    resolvePermission(sessionId: string, allowed: boolean): void;
    /**
     * Finalize assistant message — thêm vào history, lưu DB, notify frontend.
     * Xử lý trùng lặp khi CLI emit cùng message id 2 lần.
     */
    private finalizeAssistantMessage;
    /**
     * Abort session hiện tại — gửi signal abort cho SDK query
     */
    abortSession(sessionId: string): void;
    /**
     * Dừng và xóa session khỏi memory
     */
    stopSession(sessionId: string): void;
    /**
     * Kiểm tra session có active trong memory không
     */
    isSessionActive(sessionId: string): boolean;
    /**
     * Danh sách session IDs đang active
     */
    getActiveSessions(): string[];
    /**
     * Danh sách sessionId đang processing (isProcessing = true).
     * Dùng cho sidebar hiển thị trạng thái.
     */
    getProcessingSessions(): string[];
    /**
     * Lấy sessionId active cho một project
     */
    getActiveSessionForProject(projectId: string): string | null;
    /**
     * Cleanup tất cả sessions khi shutdown
     */
    cleanup(): void;
    /**
     * Nén context hội thoại (compact).
     * Flow: Gọi SDK tóm tắt hội thoại hiện tại → tạo session mới → chèn bản tóm tắt.
     * Trả về sessionId mới nếu thành công, throw nếu thất bại.
     */
    compactSession(sessionId: string): Promise<string>;
    /**
     * Thực hiện compact: gọi SDK tóm tắt → tạo session mới.
     */
    private compactFromMessages;
}
export declare const claudeService: ClaudeService;
export {};
//# sourceMappingURL=claude.d.ts.map