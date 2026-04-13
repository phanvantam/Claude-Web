/**
 * Popover hiển thị thống kê phiên chat: tokens, chi phí, model, effort, quyền.
 *
 * Tách từ ChatPage.tsx — giảm JSX trong component chính.
 */

import React from 'react';
import { message } from 'antd';
import type { ModelInfo } from '../../services/api';

/** Thống kê tổng hợp của session hiện tại */
export interface SessionStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  turns: number;
  model: string;
}

interface StatsPopoverContentProps {
  sessionId: string | null;
  sessionStats: SessionStats;
  modelOptions: ModelInfo[];
  effortLabel: string;
  permissionLabel: string;
}

/** Nội dung popover stats — hiển thị bảng key-value dọc */
const StatsPopoverContent: React.FC<StatsPopoverContentProps> = ({
  sessionId,
  sessionStats,
  modelOptions,
  effortLabel,
  permissionLabel,
}) => {
  /** Resolve model key/id sang label hiển thị thân thiện */
  const resolveModelLabel = () => {
    const m = sessionStats.model;
    const normalized = m?.replace(/\[.*\]/, '').trim();
    const found = modelOptions.find(opt =>
      opt.key === m || opt.key === normalized ||
      opt.modelId === m || opt.modelId === normalized ||
      (opt.modelId && m && (m.startsWith(opt.modelId) || opt.modelId.startsWith(m)))
    );
    return found?.label || m || '—';
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '4px 0',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
  };
  const labelStyle: React.CSSProperties = { color: 'rgba(255,255,255,0.45)' };
  const numStyle: React.CSSProperties = { fontVariantNumeric: 'tabular-nums' };

  return (
    <div style={{ fontSize: 12, minWidth: 200, color: 'rgba(255,255,255,0.85)' }}>
      {/* Session ID — dùng để debug đồng bộ giữa Web và CLI storage */}
      <div style={rowStyle}>
        <span style={labelStyle}>Session</span>
        <span
          style={{ fontFamily: 'monospace', fontSize: 10, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
          title={sessionId || '—'}
          onClick={() => { if (sessionId) { navigator.clipboard.writeText(sessionId); message.success('Đã copy Session ID'); } }}
        >{sessionId ? sessionId.slice(0, 8) + '…' : '—'}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Model</span>
        <span style={{ fontFamily: 'monospace' }}>{resolveModelLabel()}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Nỗ lực</span>
        <span style={{ fontFamily: 'monospace' }}>{effortLabel}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Quyền</span>
        <span style={{ fontFamily: 'monospace' }}>{permissionLabel}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Tokens nhận</span>
        <span style={numStyle}>{sessionStats.inputTokens.toLocaleString('vi-VN')}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Tokens gửi</span>
        <span style={numStyle}>{sessionStats.outputTokens.toLocaleString('vi-VN')}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Tổng tokens</span>
        <span style={{ fontWeight: 600, ...numStyle }}>{sessionStats.totalTokens.toLocaleString('vi-VN')}</span>
      </div>
      <div style={rowStyle}>
        <span style={labelStyle}>Chi phí</span>
        <span style={numStyle}>${sessionStats.cost.toFixed(4)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
        <span style={labelStyle}>Số lượt</span>
        <span>{sessionStats.turns}</span>
      </div>
    </div>
  );
};

export default StatsPopoverContent;
