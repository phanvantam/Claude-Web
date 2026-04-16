import React, { useState, useMemo } from 'react';
import { Typography, Spin } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ToolOutlined,
  MessageOutlined,
  ClockCircleOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { SubAgentActivity, SubAgentTimelineEvent } from '../../types';
import { sessionsApi } from '../../services/api';
import MessageContent from './MessageContent';
import InlineTimelineEvent from './InlineTimelineEvent';
import type { InlineTimelineItem } from './InlineTimelineEvent';

const { Text } = Typography;

interface SubAgentResultCardProps {
  agentName: string;
  result: string;
  isError?: boolean;
  activities?: SubAgentActivity[];
  usage?: { tokens: number; tools: number; durationMs: number };
  agentId?: string;
  /** Callback mở modal timeline chi tiết — truyền từ ChatPage → ChatWindow → Card */
  onOpenTimeline?: (agentId: string) => void;
  /** Session ID — cần để fetch timeline chi tiết */
  sessionId?: string;
}

/**
 * Card hiển thị kết quả sub-agent trên timeline chính.
 * Tách riêng để tái sử dụng giữa ChatWindow và SubAgentTimelineModal.
 */
function activitiesToInlineItems(activities: SubAgentActivity[]): InlineTimelineItem[] {
  return activities.map((act) => ({
    kind: 'tool',
    toolName: act.name,
    input: act.input,
    result: act.result,
    isError: act.isError ?? false,
  }));
}

function parseObjectLikeContent(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore parse error
  }

  return undefined;
}

function timelineEventsToInlineItems(events: SubAgentTimelineEvent[]): InlineTimelineItem[] {
  const items: InlineTimelineItem[] = [];

  for (const event of events) {
    if (event.type === 'tool_use') {
      const parsed = parseObjectLikeContent(event.content);
      const toolName = event.toolName
        || (typeof parsed?.name === 'string' ? parsed.name : undefined)
        || 'Tool';

      const input = parsed
        ? (parsed.input && typeof parsed.input === 'object'
          ? parsed.input as Record<string, unknown>
          : parsed)
        : undefined;

      items.push({
        kind: 'tool',
        toolName,
        input,
      });
      continue;
    }

    if (event.type === 'tool_result') {
      const lastTool = items.length > 0 ? items[items.length - 1] : undefined;

      if (lastTool?.kind === 'tool' && lastTool.result === undefined) {
        lastTool.result = event.content;
        lastTool.isError = event.isError ?? false;
      } else {
        items.push({
          kind: 'tool',
          toolName: 'Tool',
          result: event.content,
          isError: event.isError ?? false,
        });
      }
      continue;
    }

    if (event.type === 'thinking') {
      items.push({ kind: 'thinking', content: event.content });
      continue;
    }

    items.push({ kind: 'text', content: event.content });
  }

  return items;
}

const SubAgentResultCard: React.FC<SubAgentResultCardProps> = ({
  agentName,
  result,
  isError,
  activities,
  usage,
  agentId,
  onOpenTimeline,
  sessionId,
}) => {
  const [expanded, setExpanded] = useState(false);
  // Inline mini-timeline: load động từ API khi expand
  const [apiEvents, setApiEvents] = useState<SubAgentTimelineEvent[]>([]);
  const [loadingInline, setLoadingInline] = useState(false);
  const hasActivities = (activities?.length || 0) > 0;
  const hasExpandableContent = hasActivities || Boolean(agentId && sessionId);

  const handleToggle = () => {
    if (!hasExpandableContent) return;
    const next = !expanded;
    setExpanded(next);

    // Load inline timeline từ API khi expand lần đầu
    if (next && agentId && sessionId && apiEvents.length === 0) {
      setLoadingInline(true);
      sessionsApi.getSubAgentTimeline(sessionId, agentId)
        .then((events) => {
          setApiEvents(events);
        })
        .catch(() => setApiEvents([]))
        .finally(() => setLoadingInline(false));
    }
  };

  // Convert activities hoặc API events → inline items (gộp input + result)
  const inlineItems = useMemo(() => {
    if (apiEvents.length > 0) {
      return timelineEventsToInlineItems(apiEvents);
    }
    return activitiesToInlineItems(activities || []);
  }, [activities, apiEvents]);

  return (
    <div className={`tl-subagent-result-card ${isError ? 'error' : 'success'}`}>
      {/* Header — click để toggle inline timeline */}
      <div
        className="subagent-result-header"
        onClick={handleToggle}
        style={{ cursor: hasExpandableContent ? 'pointer' : 'default' }}
      >
        <span className="subagent-result-icon">
          {isError
            ? <CloseCircleOutlined style={{ color: 'var(--danger)', fontSize: 12 }} />
            : <CheckCircleOutlined style={{ color: 'var(--success)', fontSize: 12 }} />}
        </span>

        <Text strong style={{ fontSize: 13, color: 'var(--accent-light)' }}>
          {agentName}
        </Text>

        {hasActivities && (
          <span className="subagent-result-count">{activities!.length} bước</span>
        )}

        {hasExpandableContent && (
          <span className="subagent-result-toggle">
            {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          </span>
        )}

        {usage && (
          <div className="subagent-usage-chips">
            <span title="Tổng tokens sử dụng">
              <MessageOutlined style={{ fontSize: 10 }} /> {usage.tokens.toLocaleString()}
            </span>
            <span title="Số công cụ đã dùng">
              <ToolOutlined style={{ fontSize: 10 }} /> {usage.tools}
            </span>
            <span title="Thời gian chạy">
              <ClockCircleOutlined style={{ fontSize: 10 }} /> {(usage.durationMs / 1000).toFixed(1)}s
            </span>
            {agentId && (
              <span className="agent-id-chip" title="Agent ID">ID: {agentId}</span>
            )}
          </div>
        )}
      </div>

      {/* Inline mini-timeline khi expand */}
      {expanded && (
        <div className="subagent-inline-timeline">
          {/* Nút xem chi tiết — mở modal đầy đủ */}
          {agentId && onOpenTimeline && (
            <button
              className="subagent-timeline-detail-btn"
              onClick={(e) => {
                e.stopPropagation();
                onOpenTimeline(agentId);
              }}
            >
              Xem chi tiết →
            </button>
          )}

          {loadingInline ? (
            <div className="subagent-timeline-loading">
              <Spin indicator={<LoadingOutlined style={{ fontSize: 14, color: 'var(--accent)' }} />} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>Đang tải timeline...</span>
            </div>
          ) : (
            <div className="subagent-timeline-events">
              {inlineItems.map((item, i) => (
                <InlineTimelineEvent key={i} item={item} defaultExpanded={i < 3} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Legacy activities list — chỉ hiện khi không có API events */}
      {!expanded && hasActivities && (
        <div className="subagent-activities-list">
          {activities!.map((act, idx) => (
            <div key={idx} className="subagent-activity-item">
              <span className={`subagent-activity-status ${act.isError ? 'error' : act.result ? 'done' : ''}`}>
                {act.isError
                  ? <CloseCircleOutlined style={{ fontSize: 10 }} />
                  : act.result
                    ? <CheckCircleOutlined style={{ fontSize: 10 }} />
                    : <ToolOutlined style={{ fontSize: 10 }} />}
              </span>
              <span className="subagent-activity-name">{act.name}</span>
              <span className="subagent-activity-summary">
                {act.input && typeof act.input === 'object'
                  ? Object.entries(act.input)
                    .slice(0, 2)
                    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`)
                    .join(', ')
                  : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="subagent-result-body">
        <MessageContent content={result} />
      </div>
    </div>
  );
};

export default SubAgentResultCard;