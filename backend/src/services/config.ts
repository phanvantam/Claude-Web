import fs from 'fs';
import path from 'path';
import type { GlobalConfig } from '../types';

const DATA_DIR = path.join(__dirname, '../../data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG: GlobalConfig = {
  model: 'sonnet',
  permissionMode: 'default',
  theme: 'dark',
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
}

export function getConfig(): GlobalConfig {
  ensureDataDir();
  const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
  return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
}

export function updateConfig(config: Partial<GlobalConfig>): GlobalConfig {
  const current = getConfig();
  const updated = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated, null, 2));
  return updated;
}
