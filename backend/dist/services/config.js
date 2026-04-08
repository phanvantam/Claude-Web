"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConfig = getConfig;
exports.updateConfig = updateConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(__dirname, '../../data');
const CONFIG_FILE = path_1.default.join(DATA_DIR, 'config.json');
const DEFAULT_CONFIG = {
    model: 'sonnet',
    permissionMode: 'default',
    theme: 'dark',
};
function ensureDataDir() {
    if (!fs_1.default.existsSync(DATA_DIR)) {
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs_1.default.existsSync(CONFIG_FILE)) {
        fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    }
}
function getConfig() {
    ensureDataDir();
    const data = fs_1.default.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
}
function updateConfig(config) {
    const current = getConfig();
    const updated = { ...current, ...config };
    fs_1.default.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
    return updated;
}
//# sourceMappingURL=config.js.map