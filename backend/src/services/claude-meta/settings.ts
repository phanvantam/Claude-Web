/**
 * Đọc/ghi raw settings.json (~/.claude/settings.json).
 *
 * Tách từ claude-meta.ts — xử lý CLI settings file trực tiếp.
 */

import fs from 'fs';
import { CLAUDE_HOME, SETTINGS_FILE } from './shared';

/**
 * Đọc nội dung raw (chuỗi JSON) của ~/.claude/settings.json.
 * Trả về '{}' nếu file không tồn tại.
 */
export function getRawSettings(): string {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return '{}';
    return fs.readFileSync(SETTINGS_FILE, 'utf-8');
  } catch {
    return '{}';
  }
}

/**
 * Ghi nội dung JSON vào ~/.claude/settings.json.
 * Validate cú pháp JSON trước khi lưu — throw lỗi nếu sai.
 */
export function updateRawSettings(rawJson: string): void {
  // Validate JSON trước khi ghi — tránh phá file
  const parsed = JSON.parse(rawJson);
  const formatted = JSON.stringify(parsed, null, 2);

  // Tạo thư mục nếu chưa có
  if (!fs.existsSync(CLAUDE_HOME)) {
    fs.mkdirSync(CLAUDE_HOME, { recursive: true });
  }

  fs.writeFileSync(SETTINGS_FILE, formatted, 'utf-8');
}
