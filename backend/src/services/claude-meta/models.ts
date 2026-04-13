/**
 * Quản lý danh sách models và cấu hình model Claude CLI.
 *
 * Tách từ claude-meta.ts — nhóm các hàm liên quan đến model
 * (builtin aliases, getAllModels, getCurrentModel).
 */

import { readSettings } from './shared';

// ============================
// Types
// ============================
export interface ModelInfo {
  /** Key/alias, ví dụ: 'sonnet' */
  key: string;
  /** Tên đầy đủ (vd: Claude Sonnet...) */
  label: string;
  /** Tên hiển thị ngắn (vd: Sonnet) */
  shortLabel?: string;
  /** Model ID thực tế nếu có (từ settings env) */
  modelId?: string;
}

// Builtin model aliases — luôn có sẵn
const BUILTIN_MODELS: ModelInfo[] = [
  { key: 'sonnet', label: 'Claude Sonnet (Nhanh & Thông minh)', shortLabel: 'Sonnet' },
  { key: 'opus', label: 'Claude Opus (Mạnh nhất)', shortLabel: 'Opus' },
  { key: 'haiku', label: 'Claude Haiku (Nhanh & Rẻ)', shortLabel: 'Haiku' },
];

/**
 * Lấy danh sách models — builtin aliases + custom từ settings.
 */
export function getAllModels(): ModelInfo[] {
  const settings = readSettings();
  const env = settings?.env || {};
  const models: ModelInfo[] = [];

  for (const m of BUILTIN_MODELS) {
    // Gắn model ID thực tế từ env nếu có
    const envKey = `ANTHROPIC_DEFAULT_${m.key.toUpperCase()}_MODEL`;
    models.push({
      ...m,
      modelId: env[envKey] || undefined,
    });
  }

  // Nếu settings có model đang dùng khác với builtin aliases, thêm vào
  const currentModel = settings?.model;
  if (currentModel) {
    const baseAlias = currentModel.replace(/\[.*\]/, ''); // Bỏ suffix như [1m]
    if (!models.find(m => m.key === baseAlias)) {
      models.push({ key: currentModel, label: currentModel });
    }
  }

  return models;
}

/**
 * Lấy model đang active từ settings.json.
 */
export function getCurrentModel(): string {
  const settings = readSettings();
  return settings?.model || 'sonnet';
}
