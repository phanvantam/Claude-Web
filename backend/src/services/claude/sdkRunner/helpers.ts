/**
 * Các hàm tiện ích cho sdkRunner — trích xuất thông tin summary từ tool input
 * và rút gọn đường dẫn file để hiển thị trên UI.
 *
 * Tách ra từ sdkRunner.ts gốc để giảm kích thước file chính.
 */

/**
 * Trích xuất thông tin chính từ tool input để hiển thị ngắn gọn trên UI.
 * Ví dụ: Read → file path, Bash → command, Write → file path, etc.
 */
export function extractToolInputSummary(toolName: string, input: Record<string, unknown>): string {
  const name = toolName.toLowerCase();
  if (name === 'read' || name === 'readfile') {
    const fp = String(input.file_path || input.path || input.filePath || '');
    return fp ? shortenPath(fp) : '';
  }
  if (name === 'write' || name === 'writefile' || name === 'create') {
    const fp = String(input.file_path || input.path || input.filePath || '');
    return fp ? shortenPath(fp) : '';
  }
  if (name === 'edit' || name === 'multiedit') {
    const fp = String(input.file_path || input.path || input.filePath || '');
    return fp ? shortenPath(fp) : '';
  }
  if (name === 'bash') {
    const cmd = String(input.command || input.cmd || '');
    return cmd.length > 60 ? cmd.slice(0, 57) + '...' : cmd;
  }
  if (name === 'search' || name === 'grep' || name === 'globtool' || name === 'glob') {
    return String(input.pattern || input.query || input.glob || '').slice(0, 50);
  }
  if (name === 'listdir' || name === 'ls') {
    return String(input.path || input.dir || '').slice(0, 50);
  }
  // Fallback: trả key=value đầu tiên
  const entries = Object.entries(input);
  if (entries.length > 0) {
    const [k, v] = entries[0];
    const vs = String(v);
    return `${k}: ${vs.length > 40 ? vs.slice(0, 37) + '...' : vs}`;
  }
  return '';
}

/** Rút gọn đường dẫn file — chỉ hiện 2 phần cuối */
export function shortenPath(fp: string): string {
  const parts = fp.split('/').filter(Boolean);
  if (parts.length <= 2) return fp;
  return '.../' + parts.slice(-2).join('/');
}
