import React, { useEffect, useState } from 'react';
import { Modal, Spin, Typography, Empty } from 'antd';
import {
  BulbOutlined,
  ToolOutlined,
  MessageOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { sessionsApi } from '../../services/api';
import type { SubAgentInfo, SubAgentTimelineEvent } from '../../types';

const { Text } = Typography;

interface SubAgentTimelineModalProps {
  open: boolean;
  onClose: () => void;
  /** Session ID — dùng để gọi API */
  sessionId: string | null;
  /** Agent ID đang xem */
  agentId: string | null;
  /** Metadata agent — hiển thị title */
  agentInfo?: SubAgentInfo | null;
}

/**
 * Modal hiển thị timeline events chi tiết của một sub-agent.
 * Tái sử dụng CSS pattern từ ChatWindow (tl-block-row, tl-dot).
 */
const SubAgentTimelineModal: React.FC<SubAgentTimelineModalProps> = ({
  open,
  onClose,
  sessionId,
  agentId,
  agentInfo,
}) => {
  const [events, setEvents] = useState<SubAgentTimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);

  /** Full-screen modal trên mobile */
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (!open || !sessionId || !agentId) {
      setEvents([]);
      return;
    }

    setLoading(true);
    sessionsApi.getSubAgentTimeline(sessionId, agentId)
      .then(setEvents)
      .catch((err) => {
        console.error('[SubAgentTimeline] Lỗi tải timeline:', err);
        setEvents([]);
      })
      .finally(() => setLoading(false));
  }, [open, sessionId, agentId]);

  /**
   * Format timestamp ISO → giờ:phút:giây.
   */
  const formatTime = (ts: string) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  /**
   * Xác định icon + CSS class cho mỗi event type.
   * Giữ nhất quán với visual language của ChatWindow.
   */
  const getEventDot = (event: SubAgentTimelineEvent) => {
    switch (event.type) {
      case 'thinking':
        return {
          className: 'tl-dot dot-thinking-content',
          icon: <BulbOutlined style={{ fontSize: 12 }} />,
          label: 'Suy luận',
          color: '#f1c40f',
        };
      case 'tool_use':
        return {
          className: 'tl-dot dot-tool',
          icon: <ToolOutlined style={{ fontSize: 11 }} />,
          label: event.toolName || 'Tool',
          color: '#e17055',
        };
      case 'tool_result':
        return {
          className: event.isError ? 'tl-dot dot-tool-error' : 'tl-dot dot-tool-success',
          icon: event.isError
            ? <CloseCircleOutlined style={{ fontSize: 11 }} />
            : <CheckCircleOutlined style={{ fontSize: 11 }} />,
          label: event.isError ? 'Lỗi' : 'Kết quả',
          color: event.isError ? '#ff6b6b' : '#51cf66',
        };
      case 'text':
        return {
          className: 'tl-dot dot-text',
          icon: <MessageOutlined style={{ fontSize: 10 }} />,
          label: 'Phản hồi',
          color: 'var(--accent)',
        };
      default:
        return {
          className: 'tl-dot dot-text',
          icon: <MessageOutlined style={{ fontSize: 10 }} />,
          label: 'Event',
          color: 'var(--text-muted)',
        };
    }
  };

  /**
   * Cắt nội dung quá dài cho hiển thị tóm tắt.
   * Thinking và text giữ nguyên. Tool input/result giới hạn 500 ký tự.
   */
  const truncateContent = (content: string, type: string) => {
    if (type === 'thinking' || type === 'text') return content;
    if (content.length > 500) return content.slice(0, 500) + '\n...';
    return content;
  };

  return (
    <Modal
      className="dark-modal"
      open={open}
      onCancel={onClose}
      footer={null}
      width={isMobile ? '100%' : 720}
      style={{ top: isMobile ? 0 : 40 }}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RobotOutlined style={{ fontSize: 15, color: 'var(--accent)' }} />
            <span>{agentInfo?.agentType || 'Sub Agent'}</span>
            {agentInfo?.startedAt && (
              <Text style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 400, fontFamily: "'JetBrains Mono', monospace" }}>
                {new Date(agentInfo.startedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </div>
          {agentInfo?.description && (
            <Text style={{
              color: 'var(--text-secondary)',
              fontWeight: 400,
              fontSize: 12,
              lineHeight: 1.4,
              paddingLeft: 23,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}>
              {agentInfo.description}
            </Text>
          )}
        </div>
      }
      styles={{
        header: {
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border)',
          padding: '16px 24px',
        },
        body: {
          background: 'var(--bg-primary)',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: '16px 24px',
        },
      }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin indicator={<LoadingOutlined style={{ fontSize: 24, color: 'var(--accent)' }} />} />
          <div style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 13 }}>
            Đang tải timeline...
          </div>
        </div>
      ) : events.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Không có dữ liệu timeline
            </Text>
          }
        />
      ) : (
        <div className="subagent-timeline">
          {events.map((event, i) => {
            const dot = getEventDot(event);
            return (
              <div key={i} className="sa-tl-row">
                {/* Timeline line */}
                <div className="sa-tl-line-col">
                  <div className="sa-tl-line" />
                  <div className={`sa-tl-dot ${event.type}`}>
                    {dot.icon}
                  </div>
                </div>

                {/* Content */}
                <div className="sa-tl-content">
                  {/* Label + timestamp */}
                  <div className="sa-tl-header">
                    <span className="sa-tl-label" style={{ color: dot.color }}>
                      {dot.label}
                    </span>
                    {event.timestamp && (
                      <span className="sa-tl-time">{formatTime(event.timestamp)}</span>
                    )}
                  </div>

                  {/* Event body */}
                  <div className={`sa-tl-body sa-tl-type-${event.type}`}>
                    {event.type === 'thinking' ? (
                      <div className="thinking-text">{event.content}</div>
                    ) : event.type === 'text' ? (
                      <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {event.content}
                      </div>
                    ) : (
                      <pre className="tl-tool-json">
                        {truncateContent(event.content, event.type)}
                      </pre>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

export default SubAgentTimelineModal;
