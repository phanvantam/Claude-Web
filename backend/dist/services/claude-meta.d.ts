export interface SlashCommand {
    /** Tên lệnh, ví dụ: /commit */
    cmd: string;
    /** Mô tả ngắn */
    desc: string;
    /** Nguồn gốc: 'builtin' hoặc tên plugin */
    source: string;
}
export interface ModelInfo {
    /** Key/alias, ví dụ: 'sonnet' */
    key: string;
    /** Tên hiển thị */
    label: string;
    /** Model ID thực tế nếu có (từ settings env) */
    modelId?: string;
}
/**
 * Lấy toàn bộ slash commands — builtin + plugin.
 * Loại trùng lặp theo cmd name (builtin ưu tiên).
 */
export declare function getAllCommands(): SlashCommand[];
/**
 * Lấy danh sách models — builtin aliases + custom từ settings.
 */
export declare function getAllModels(): ModelInfo[];
/**
 * Lấy model đang active từ settings.json.
 */
export declare function getCurrentModel(): string;
/**
 * Đọc nội dung raw (chuỗi JSON) của ~/.claude/settings.json.
 * Trả về '{}' nếu file không tồn tại.
 */
export declare function getRawSettings(): string;
/**
 * Ghi nội dung JSON vào ~/.claude/settings.json.
 * Validate cú pháp JSON trước khi lưu — throw lỗi nếu sai.
 */
export declare function updateRawSettings(rawJson: string): void;
/**
 * Lấy danh sách agent files (.md) trong ~/.claude/agents/.
 */
export declare function listAgents(): {
    name: string;
    filename: string;
}[];
/**
 * Đọc nội dung một agent file.
 */
export declare function getAgent(filename: string): string;
/**
 * Ghi nội dung vào agent file. Tạo thư mục nếu chưa có.
 */
export declare function saveAgent(filename: string, content: string): void;
/**
 * Tạo agent file mới.
 */
export declare function createAgent(name: string): string;
/**
 * Xóa agent file.
 */
export declare function deleteAgent(filename: string): void;
/**
 * Lấy cấu hình mcpServers (JSON string đã format).
 * Hỗ trợ trộn cả ~/.claude.json và <projectPath>/.mcp.json (nếu có).
 */
export declare function getMcpServers(projectPath?: string): string;
/**
 * Cập nhật mcpServers trong ~/.claude.json.
 * Chỉ ghi đè trường mcpServers, giữ nguyên toàn bộ dữ liệu khác.
 */
export declare function updateMcpServers(rawJson: string): void;
//# sourceMappingURL=claude-meta.d.ts.map