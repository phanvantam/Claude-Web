/**
 * File này hiện là entry point để duy trì tính tương thích với các import cũ.
 * Logic thực tế đã được chia nhỏ vào thư mục ./claude/ để dễ bảo trì.
 */

import { ClaudeService } from './claude/claudeService';

// Khởi tạo instance duy nhất để dùng chung cho toàn hệ thống
export const claudeService = new ClaudeService();

// Re-export các types và utils để đảm bảo các file khác import không bị lỗi
export * from './claude/claudeService';
export * from './claude/types';
export * from './claude/utils';
