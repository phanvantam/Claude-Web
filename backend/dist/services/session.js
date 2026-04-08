"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllSessions = getAllSessions;
exports.getSession = getSession;
exports.saveSession = saveSession;
exports.deleteSession = deleteSession;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(__dirname, '../../data');
const SESSIONS_DIR = path_1.default.join(DATA_DIR, 'sessions');
function ensureDataDir() {
    if (!fs_1.default.existsSync(SESSIONS_DIR)) {
        fs_1.default.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
}
function getAllSessions() {
    ensureDataDir();
    const files = fs_1.default.readdirSync(SESSIONS_DIR);
    const sessions = [];
    for (const file of files) {
        if (!file.endsWith('.json'))
            continue;
        try {
            const data = fs_1.default.readFileSync(path_1.default.join(SESSIONS_DIR, file), 'utf-8');
            const session = JSON.parse(data);
            sessions.push(session);
        }
        catch (e) {
            console.error(`Failed to read session file: ${file}`, e);
        }
    }
    // Sort by updatedAt descending
    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
function getSession(id) {
    ensureDataDir();
    const filePath = path_1.default.join(SESSIONS_DIR, `${id}.json`);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const data = fs_1.default.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    }
    catch (e) {
        return null;
    }
}
function saveSession(session) {
    ensureDataDir();
    const filePath = path_1.default.join(SESSIONS_DIR, `${session.id}.json`);
    session.updatedAt = new Date().toISOString();
    fs_1.default.writeFileSync(filePath, JSON.stringify(session, null, 2));
}
function deleteSession(id) {
    ensureDataDir();
    const filePath = path_1.default.join(SESSIONS_DIR, `${id}.json`);
    if (!fs_1.default.existsSync(filePath))
        return false;
    try {
        fs_1.default.unlinkSync(filePath);
        return true;
    }
    catch (e) {
        return false;
    }
}
//# sourceMappingURL=session.js.map