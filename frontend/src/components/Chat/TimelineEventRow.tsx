import React, { useEffect, useMemo, useState } from 'react';
import {
  BulbOutlined,
  ToolOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  MessageOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
} from '@ant-design/icons';
import type { SubAgentTimelineEvent } from '../../types';

/** Dot config cho mỗi event type — dùng chung cho cả chat timeline lẫn modal */
export function getEventDotConfig(event: SubAgentTimelineEvent) {
  switch (event.type) {
    case 'thinking':
      return {
        dotClassName: 'tl-dot dot-thinking-content',
        dotIcon: <BulbOutlined style={{ fontSize: 12 }} />,
        dotColor: '#f1c40f',
        label: 'Suy luận',
      };
    case 'tool_use':
      return {
        dotClassName: 'tl-dot dot-tool',
        dotIcon: <ToolOutlined style={{ fontSize: 11 }} />,
        dotColor: '#e17055',
        label: event.toolName || 'Tool',
      };
    case 'tool_result':
      return {
        dotClassName: event.isError ? 'tl-dot dot-tool-error' : 'tl-dot dot-tool-success',
        dotIcon: event.isError
          ? <CloseCircleOutlined style={{ fontSize: 11 }} />
          : <CheckCircleOutlined style={{ fontSize: 11 }} />,
        dotColor: event.isError ? '#ff6b6b' : '#51cf66',
        label: event.isError ? 'Lỗi' : 'Kết quả',
      };
    case 'text':
    default:
      return {
        dotClassName: 'tl-dot dot-text',
        dotIcon: <MessageOutlined style={{ fontSize: 10 }} />,
        dotColor: undefined,
        label: 'Phản hồi',
      };
  }
}

/** Cắt nội dung quá dài */
export function truncateContent(content: string, type: string, maxLen = 500) {
  if (type === 'thinking' || type === 'text') return content;
  if (content.length > maxLen) return content.slice(0, maxLen) + '\n...';
  return content;
}

/** Format timestamp ISO → giờ:phút:giây */
export function formatEventTime(ts: string) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function tryParseToolContent(content: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(content);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
    return null;
  } catch {
    return null;
  }
}

export interface TimelineEventRowProps {
  event: SubAgentTimelineEvent;
  defaultExpanded?: boolean;
}

/**
 * Event row tái sử dụng cho sub-agent timeline.
 * Mỗi event có header + collapse body tương tự message blocks ngoài chat.
 */
const TimelineEventRow: React.FC<TimelineEventRowProps> = ({
  event,
  defaultExpanded = true,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);

  useEffect(() => {
    setExpanded(defaultExpanded);
  }, [defaultExpanded]);

  const dot = getEventDotConfig(event);
  const parsedTool = useMemo(
    () => (event.type === 'tool_use' || event.type === 'tool_result')
      ? tryParseToolContent(event.content)
      : null,
    [event],
  );

  const preview = useMemo(() => {
    if (event.type === 'tool_use') {
      if (parsedTool) {
        const toolName = (parsedTool as Record<string, unknown>).name;
        if (typeof toolName === 'string' && toolName.length > 0) return toolName;
      }
      return truncateContent(event.content, event.type, 80).replace(/\n/g, ' ');
    }
    return truncateContent(event.content, event.type, 120).replace(/\n/g, ' ');
  }, [event, parsedTool]);

  return (
    <div
      className="sa-event-item"
      style={{
        borderColor: dot.dotColor ? `${dot.dotColor}33` : undefined,
        background: dot.dotColor ? `${dot.dotColor}0D` : undefined,
      }}
    >
      <div className="sa-event-header" onClick={() => setExpanded((v) => !v)}>
        <span className="sa-event-icon" style={{ color: dot.dotColor }}>{dot.dotIcon}</span>
        <span className="sa-event-role" style={{ color: dot.dotColor }}>{dot.label}</span>

        {!expanded && (
          <span className="sa-event-preview">{preview}</span>
        )}

        <div className="sa-event-meta">
          <span className="sa-event-time">{formatEventTime(event.timestamp)}</span>
          <span className="sa-event-toggle">
            {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="sa-event-body">
          {event.type === 'thinking' && (
            <div className="thinking-text">{event.content}</div>
          )}

          {event.type === 'text' && (
            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{event.content}</div>
          )}

          {(event.type === 'tool_use' || event.type === 'tool_result') && (
            parsedTool ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {Object.entries(parsedTool).map(([key, value]) => (
                  <div key={key} className="sa-tool-row">
                    <span className="sa-tool-key">{key}:</span>
                    <span className="sa-tool-val">
                      {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <pre className="tl-tool-json" style={{ margin: 0 }}>
                {truncateContent(event.content, event.type)}
              </pre>
            )
          )}
        </div>
      )}
    </div>
  );
};

export default TimelineEventRow;