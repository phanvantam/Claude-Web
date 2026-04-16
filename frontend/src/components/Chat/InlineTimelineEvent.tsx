import React, { useMemo, useState } from 'react';
import {
  BulbOutlined,
  ToolOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  MessageOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
} from '@ant-design/icons';

export interface InlineTimelineItem {
  kind: 'tool' | 'text' | 'thinking';
  toolName?: string;
  input?: Record<string, unknown>;
  result?: string;
  content?: string;
  isError?: boolean;
}

interface InlineTimelineEventProps {
  item: InlineTimelineItem;
  defaultExpanded?: boolean;
}

function getItemMeta(item: InlineTimelineItem) {
  if (item.kind === 'thinking') {
    return { icon: <BulbOutlined />, color: '#f1c40f', label: 'Suy luận' };
  }

  if (item.kind === 'tool') {
    if (item.result !== undefined) {
      return item.isError
        ? { icon: <CloseCircleOutlined />, color: '#ff6b6b', label: `${item.toolName || 'Tool'} · Lỗi` }
        : { icon: <CheckCircleOutlined />, color: '#51cf66', label: `${item.toolName || 'Tool'} · Kết quả` };
    }

    return { icon: <ToolOutlined />, color: '#e17055', label: item.toolName || 'Tool' };
  }

  return { icon: <MessageOutlined />, color: '#6c5ce7', label: 'Text' };
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function buildPreview(item: InlineTimelineItem): string {
  if (item.kind === 'tool') {
    if (item.result) return item.result.slice(0, 120).replace(/\n/g, ' ');
    if (item.input) return Object.entries(item.input).slice(0, 2).map(([k, v]) => `${k}: ${stringifyValue(v)}`).join(', ').slice(0, 120);
    return item.toolName || 'Tool';
  }

  return (item.content || '').slice(0, 120).replace(/\n/g, ' ');
}

const InlineTimelineEvent: React.FC<InlineTimelineEventProps> = ({
  item,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const meta = useMemo(() => getItemMeta(item), [item]);
  const preview = useMemo(() => buildPreview(item), [item]);
  const entries = useMemo(() => Object.entries(item.input || {}), [item.input]);

  return (
    <div className="inline-event-item" style={{ borderLeftColor: meta.color }}>
      <div className="inline-event-header" onClick={() => setExpanded((v) => !v)}>
        <div className="inline-event-main">
          <span className="inline-event-icon" style={{ color: meta.color }}>{meta.icon}</span>
          <span className="inline-event-label" style={{ color: meta.color }} title={meta.label}>{meta.label}</span>
          <span className="inline-event-toggle">
            {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          </span>
        </div>

        {!expanded && <span className="inline-event-preview">{preview}</span>}
      </div>

      {expanded && (
        <div className="inline-event-body">
          {item.kind === 'tool' ? (
            <>
              {entries.length > 0 && (
                <div className="inline-event-tool-data">
                  {entries.map(([key, value]) => (
                    <div key={key} className="inline-tool-row">
                      <span className="inline-tool-key">{key}:</span>
                      <span className="inline-tool-val">{stringifyValue(value)}</span>
                    </div>
                  ))}
                </div>
              )}

              {item.result !== undefined && (
                <pre className="inline-event-raw">{item.result}</pre>
              )}

              {entries.length === 0 && item.result === undefined && (
                <div className="inline-event-text">Không có dữ liệu.</div>
              )}
            </>
          ) : (
            <div className="inline-event-text">{item.content || ''}</div>
          )}
        </div>
      )}
    </div>
  );
};

export default InlineTimelineEvent;
