"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const DATA_DIR = path_1.default.join(__dirname, '../../data');
const DB_PATH = path_1.default.join(DATA_DIR, 'database.sqlite');
// Đảm bảo thư mục data/ tồn tại trước khi tạo DB
if (!fs_1.default.existsSync(DATA_DIR)) {
    fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
}
/**
 * Khởi tạo kết nối SQLite đồng bộ.
 * WAL mode cho phép đọc/ghi song song tốt hơn.
 */
const db = new better_sqlite3_1.default(DB_PATH);
// Bật WAL mode để tăng hiệu năng đọc song song
db.pragma('journal_mode = WAL');
// Bật foreign keys
db.pragma('foreign_keys = ON');
/**
 * Khởi tạo schema CSDL.
 * Tạo các bảng nếu chưa tồn tại.
 */
function initSchema() {
    db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      description TEXT,
      active_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      name TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      total_cost REAL,
      model TEXT,
      effort_level TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      blocks TEXT,
      tool_calls TEXT,
      model TEXT,
      cost REAL,
      tokens_input INTEGER,
      tokens_output INTEGER,
      duration_ms INTEGER,
      is_streaming INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session
      ON chat_messages(session_id, sort_order);

    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL DEFAULT '{}'
    );

    -- Đảm bảo luôn có 1 row config mặc định
    INSERT OR IGNORE INTO config (id, data) VALUES (1, '{}');
  `);
    // Migration: thêm cột duration_ms cho DB cũ (bỏ qua nếu đã có)
    try {
        db.exec('ALTER TABLE chat_messages ADD COLUMN duration_ms INTEGER');
    }
    catch (_e) {
        // column đã tồn tại
    }
    // Migration: thêm cột effort_level cho sessions cũ
    try {
        db.exec('ALTER TABLE sessions ADD COLUMN effort_level TEXT');
    }
    catch (_e) {
        // column đã tồn tại
    }
    // Migration: thêm cột permission_mode cho sessions cũ
    try {
        db.exec('ALTER TABLE sessions ADD COLUMN permission_mode TEXT');
    }
    catch (_e) {
        // column đã tồn tại
    }
}
initSchema();
exports.default = db;
//# sourceMappingURL=db.js.map