"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = getConfig;
exports.updateConfig = updateConfig;
const db_1 = __importDefault(require("./db"));
const DEFAULT_CONFIG = {
    model: 'sonnet',
    permissionMode: 'default',
    theme: 'dark',
};
/**
 * Đọc config từ CSDL, merge với default để đảm bảo luôn có đầy đủ giá trị.
 */
function getConfig() {
    const row = db_1.default.prepare('SELECT data FROM config WHERE id = 1').get();
    if (!row)
        return { ...DEFAULT_CONFIG };
    try {
        const parsed = JSON.parse(row.data);
        return { ...DEFAULT_CONFIG, ...parsed };
    }
    catch {
        return { ...DEFAULT_CONFIG };
    }
}
/**
 * Cập nhật config — merge giá trị mới vào config hiện tại rồi ghi lại.
 */
function updateConfig(config) {
    const current = getConfig();
    const updated = { ...current, ...config };
    db_1.default.prepare('UPDATE config SET data = ? WHERE id = 1').run(JSON.stringify(updated));
    return updated;
}
//# sourceMappingURL=config.js.map