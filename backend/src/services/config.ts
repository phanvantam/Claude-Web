import db from './db';
import type { GlobalConfig } from '../types';

const DEFAULT_CONFIG: GlobalConfig = {
  model: 'sonnet',
  permissionMode: 'default',
  theme: 'dark',
};

/**
 * Đọc config từ CSDL, merge với default để đảm bảo luôn có đầy đủ giá trị.
 */
export function getConfig(): GlobalConfig {
  const row = db.prepare('SELECT data FROM config WHERE id = 1').get() as { data: string } | undefined;
  if (!row) return { ...DEFAULT_CONFIG };

  try {
    const parsed = JSON.parse(row.data);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Cập nhật config — merge giá trị mới vào config hiện tại rồi ghi lại.
 */
export function updateConfig(config: Partial<GlobalConfig>): GlobalConfig {
  const current = getConfig();
  const updated = { ...current, ...config };

  db.prepare('UPDATE config SET data = ? WHERE id = 1').run(JSON.stringify(updated));

  return updated;
}
