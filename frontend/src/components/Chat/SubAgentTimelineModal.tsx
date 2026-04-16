import React, { useEffect, useState, useMemo } from 'react';
import { Modal, Spin, Typography, Empty } from 'antd';
import {
  LoadingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { sessionsApi } from '../../services/api';
import type { SubAgentInfo, SubAgentTimelineEvent } from '../../types';
import TimelineEventRow from './TimelineEventRow';

const { Text } = Typography;

interface SubAgentTimelineModalProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  agentId: string | null;
  agentInfo?: SubAgentInfo | null;
}

/**
 * Modal hiển thị timeline events chi tiết của một sub-agent.
 * Tái sử dụng TimelineEventRow để đồng bộ UI với timeline chat chính.
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
  const [allExpanded, setAllExpanded] = useState(true);

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

  // Đếm các loại event để show summary
  const eventCounts = useMemo(() => {
    const counts = { thinking: 0, tool_use: 0, tool_result: 0, text: 0 };
    for (const e of events) counts[e.type] = (counts[e.type] || 0) + 1;
    return counts;
  }, [events]);

  return (
    <Modal
      className="dark-modal"
      open={open}
      onCancel={onClose}
      footer={null}
      width={isMobile ? '100%' : 680}
      style={{ top: isMobile ? 0 : 40 }}
      title={
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Agent header — tên + icon màu theo loại agent */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>
              <ThunderboltOutlined style={{ color: 'var(--accent)' }} />
            </span>
            <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
              {agentInfo?.name || agentInfo?.agentType || 'Sub Agent'}
            </span>
            {agentInfo?.startedAt && (
              <Text style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
                {new Date(agentInfo.startedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
            {/* Summary badges */}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {eventCounts.thinking > 0 && (
                <span className="tl-subagent-step-count" style={{ color: '#f1c40f', borderColor: 'rgba(241,196,15,0.3)', background: 'rgba(241,196,15,0.08)' }}>
                  {eventCounts.thinking} suy luận
                </span>
              )}
              {eventCounts.tool_use > 0 && (
                <span className="tl-subagent-step-count" style={{ color: '#e17055', borderColor: 'rgba(225,112,85,0.3)', background: 'rgba(225,112,85,0.08)' }}>
                  {eventCounts.tool_use} tool
                </span>
              )}
              {eventCounts.tool_result > 0 && (
                <span className="tl-subagent-step-count" style={{ color: '#51cf66', borderColor: 'rgba(81,207,102,0.3)', background: 'rgba(81,207,102,0.08)' }}>
                  {eventCounts.tool_result} kết quả
                </span>
              )}
            </div>
          </div>
          {/* Description */}
          {agentInfo?.description && (
            <Text style={{
              color: 'var(--text-secondary)',
              fontWeight: 400,
              fontSize: 12,
              lineHeight: 1.4,
              paddingLeft: 26,
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
          padding: '14px 20px',
        },
        body: {
          background: 'var(--bg-primary)',
          maxHeight: '80vh',
          overflowY: 'auto',
          padding: '12px 20px 20px',
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
        <div className="subagent-timeline-modal">
          {/* Controls row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <button
              onClick={() => setAllExpanded(!allExpanded)}
              style={{
                background: 'rgba(108, 92, 231, 0.1)',
                border: '1px solid rgba(108, 92, 231, 0.2)',
                borderRadius: 6,
                color: 'var(--accent-light)',
                fontSize: 11,
                padding: '3px 10px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
            >
              {allExpanded ? 'Thu gọn tất cả' : 'Mở rộng tất cả'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {events.length} sự kiện
            </span>
          </div>

          {/* Events list — dùng TimelineEventRow tái sử dụng */}
          {events.map((event, i) => {
            const color = (() => {
              switch (event.type) {
                case 'thinking':
                  return {
                    bg: 'rgba(241, 196, 15, 0.06)',
                    border: 'rgba(241, 196, 15, 0.15)',
                  };
                case 'tool_use':
                  return {
                    bg: 'rgba(225, 112, 85, 0.05)',
                    border: 'rgba(225, 112, 85, 0.15)',
                  };
                case 'tool_result':
                  return event.isError
                    ? {
                      bg: 'rgba(255, 107, 107, 0.05)',
                      border: 'rgba(255, 107, 107, 0.15)',
                    }
                    : {
                      bg: 'rgba(81, 207, 102, 0.05)',
                      border: 'rgba(81, 207, 102, 0.15)',
                    };
                case 'text':
                default:
                  return {
                    bg: 'rgba(108, 92, 231, 0.05)',
                    border: 'rgba(108, 92, 231, 0.15)',
                  };
              }
            })();

            return (
              <div
                key={i}
                className="sa-event-wrapper"
                style={{
                  background: color.bg,
                  border: `1px solid ${color.border}`,
                  borderRadius: 10,
                  marginBottom: 8,
                  overflow: 'hidden',
                }}
              >
                <TimelineEventRow
                  event={event}
                  defaultExpanded={allExpanded}
                />
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
};

export default SubAgentTimelineModal;