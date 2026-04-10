import fs from 'fs';
import path from 'path';

/**
 * Logger đơn giản ghi ra file + console song song.
 * - File log nằm ở backend/logs/claude-{YYYY-MM-DD}.log
 * - Tự rotate theo ngày (mỗi ngày 1 file)
 * - Append mode, không mất log khi restart
 */

const LOG_DIR = path.join(__dirname, '../../logs');

/** Đảm bảo thư mục logs tồn tại */
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/** Lấy tên file log theo ngày hiện tại */
function getLogFileName(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(LOG_DIR, `claude-${date}.log`);
}

/** Cache write stream, rotate khi đổi ngày */
let currentDate = '';
let stream: fs.WriteStream | null = null;

function getStream(): fs.WriteStream {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== currentDate || !stream) {
    // Đóng stream cũ nếu đổi ngày
    if (stream) {
      stream.end();
    }
    currentDate = today;
    stream = fs.createWriteStream(getLogFileName(), { flags: 'a' });
  }
  return stream;
}

/** Format timestamp cho mỗi dòng log */
function timestamp(): string {
  return new Date().toISOString();
}

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

/**
 * Ghi 1 dòng log ra file và console.
 * Format: [2026-04-10T01:15:42.123Z] [INFO] message
 */
function log(level: LogLevel, ...args: unknown[]): void {
  const msg = args.map(a => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.message}\n${a.stack}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');

  const line = `[${timestamp()}] [${level}] ${msg}\n`;

  // Ghi ra file — non-blocking
  try {
    getStream().write(line);
  } catch {
    // Fallback nếu stream lỗi — không crash app
  }

  // Vẫn giữ console output cho dev
  switch (level) {
    case 'ERROR':
      console.error(msg);
      break;
    case 'WARN':
      console.warn(msg);
      break;
    default:
      console.log(msg);
      break;
  }
}

/** API chính — dùng thay console.log/warn/error */
export const logger = {
  info: (...args: unknown[]) => log('INFO', ...args),
  warn: (...args: unknown[]) => log('WARN', ...args),
  error: (...args: unknown[]) => log('ERROR', ...args),
  debug: (...args: unknown[]) => log('DEBUG', ...args),
};
