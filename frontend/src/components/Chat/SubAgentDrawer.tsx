import React, { useState, useEffect } from 'react';
import { Drawer, Typography, Empty, Button, Tooltip } from 'antd';
import {
  RobotOutlined,
  ClockCircleOutlined,
  ThunderboltOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import type { SubAgentInfo } from '../../types';

const { Text } = Typography;

interface SubAgentDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Danh sách sub-agents đã chạy trong session */
  agents: SubAgentInfo[];
  /** Callback khi user click vào agent → mở modal timeline */
  onSelectAgent: (agentId: string) => void;
  /** Đang tải danh sách */
  loading?: boolean;
  /** Callback refresh danh sách thủ công */
  onRefresh?: () => void;
}

/**
 * Drawer bên phải hiển thị danh sách sub-agents đã chạy trong session hiện tại.
 * Click vào agent sẽ gọi onSelectAgent → parent mở Modal timeline.
 */
const SubAgentDrawer: React.FC<SubAgentDrawerProps> = ({
  open,
  onClose,
  agents,
  onSelectAgent,
  loading = false,
  onRefresh,
}) => {
  /** Full-width drawer trên mobile */
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /**
   * Format timestamp ISO → giờ:phút dạng tiếng Việt.
   */
  const formatTime = (ts?: string) => {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /**
   * Chọn icon cho loại agent — mỗi loại có màu riêng để phân biệt.
   */
  const getAgentIcon = (agentType?: string) => {
    if (!agentType) return <RobotOutlined style={{ color: 'var(--accent)' }} />;
    switch (agentType.toLowerCase()) {
      case 'bash':
      case 'terminal':
        return <ThunderboltOutlined style={{ color: '#e17055' }} />;
      default:
        return <RobotOutlined style={{ color: 'var(--accent)' }} />;
    }
  };

  return (
    <Drawer
      className="mcp-drawer"
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RobotOutlined style={{ color: 'var(--accent)', fontSize: 16 }} />
          <span>Sub Agents</span>
          {agents.length > 0 && (
            <span style={{
              background: 'rgba(108, 92, 231, 0.2)',
              color: 'var(--accent)',
              fontSize: 11,
              padding: '1px 8px',
              borderRadius: 10,
              fontWeight: 600,
            }}>
              {agents.length}
            </span>
          )}
          {/* Spacer */}
          <div style={{ flex: 1 }} />
          {onRefresh && (
            <Tooltip title="Làm mới danh sách">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined spin={loading} />}
                onClick={onRefresh}
                style={{ color: 'rgba(255,255,255,0.4)', marginRight: -8 }}
              />
            </Tooltip>
          )}
        </div>
      }
      placement="right"
      onClose={onClose}
      open={open}
      styles={{
        wrapper: { width: isMobile ? '100%' : 340 },
        header: {
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border)',
        },
        body: {
          background: 'var(--bg-primary)',
          padding: '12px',
        },
      }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          Đang tải...
        </div>
      ) : agents.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Text style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Chưa có sub-agent nào được gọi trong phiên này
            </Text>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {agents.map((agent) => (
            <div
              key={agent.agentId}
              className="subagent-card"
              onClick={() => onSelectAgent(agent.agentId)}
              style={{
                padding: '12px 14px',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-accent)';
                e.currentTarget.style.boxShadow = 'var(--shadow-glow)';
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)';
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              {/* Header: icon + agentType */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>{getAgentIcon(agent.agentType)}</span>
                <Text strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>
                  {agent.agentType || 'Unknown Agent'}
                </Text>
              </div>

              {/* Mô tả agent */}
              <Text style={{
                color: 'var(--text-secondary)',
                fontSize: 12,
                display: 'block',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginBottom: 6,
              }}>
                {agent.description || 'Không có mô tả'}
              </Text>

              {/* Footer: event count + thời gian */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {agent.messageCount} events
                </span>
                {agent.startedAt && (
                  <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>
                    <ClockCircleOutlined style={{ fontSize: 10 }} />
                    {formatTime(agent.startedAt)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
};

export default SubAgentDrawer;
