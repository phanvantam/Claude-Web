"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/**
 * Logger đơn giản ghi ra file + console song song.
 * - File log nằm ở backend/logs/claude-{YYYY-MM-DD}.log
 * - Tự rotate theo ngày (mỗi ngày 1 file)
 * - Append mode, không mất log khi restart
 */
const LOG_DIR = path_1.default.join(__dirname, '../../logs');
/** Đảm bảo thư mục logs tồn tại */
if (!fs_1.default.existsSync(LOG_DIR)) {
    fs_1.default.mkdirSync(LOG_DIR, { recursive: true });
}
/** Lấy tên file log theo ngày hiện tại */
function getLogFileName() {
    const now = new Date();
    const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
    return path_1.default.join(LOG_DIR, `claude-${date}.log`);
}
/** Cache write stream, rotate khi đổi ngày */
let currentDate = '';
let stream = null;
function getStream() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== currentDate || !stream) {
        // Đóng stream cũ nếu đổi ngày
        if (stream) {
            stream.end();
        }
        currentDate = today;
        stream = fs_1.default.createWriteStream(getLogFileName(), { flags: 'a' });
    }
    return stream;
}
/** Format timestamp cho mỗi dòng log */
function timestamp() {
    return new Date().toISOString();
}
/**
 * Ghi 1 dòng log ra file và console.
 * Format: [2026-04-10T01:15:42.123Z] [INFO] message
 */
function log(level, ...args) {
    const msg = args.map(a => {
        if (typeof a === 'string')
            return a;
        if (a instanceof Error)
            return `${a.message}\n${a.stack}`;
        try {
            return JSON.stringify(a);
        }
        catch {
            return String(a);
        }
    }).join(' ');
    const line = `[${timestamp()}] [${level}] ${msg}\n`;
    // Ghi ra file — non-blocking
    try {
        getStream().write(line);
    }
    catch {
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
exports.logger = {
    info: (...args) => log('INFO', ...args),
    warn: (...args) => log('WARN', ...args),
    error: (...args) => log('ERROR', ...args),
    debug: (...args) => log('DEBUG', ...args),
};
//# sourceMappingURL=logger.js.map