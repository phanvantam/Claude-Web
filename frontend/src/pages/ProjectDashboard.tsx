import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Typography, Spin, Empty, message, Tooltip, Popconfirm } from 'antd';
import {
  PlusOutlined,
  MessageOutlined,
  FolderOpenOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  ClockCircleOutlined,
  RobotOutlined,
  ArrowRightOutlined,
  PlayCircleOutlined,
  LoadingOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { projectsApi, sessionsApi } from '../services/api';
import type { Project, ChatSession } from '../types';

const { Title, Text, Paragraph } = Typography;

/**
 * Trang Dashboard riêng cho từng dự án.
 * Hiển thị thống kê (cost, tokens, sessions) và danh sách phiên chat.
 * Là điểm đến mặc định khi chọn dự án từ trang chủ,
 * thay vì vào thẳng giao diện Chat.
 */
const ProjectDashboard: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;

    setLoading(true);
    Promise.all([
      projectsApi.getById(projectId),
      projectsApi.getSessions(projectId),
    ])
      .then(([proj, sess]) => {
        setProject(proj);
        setSessions(sess);
      })
      .catch(() => {
        message.error('Không tìm thấy dự án');
        navigate('/');
      })
      .finally(() => setLoading(false));
  }, [projectId, navigate]);

  /** Tính toán thống kê tổng hợp cho dự án */
  const stats = useMemo(() => {
    let totalCost = 0;
    let totalMessages = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const s of sessions) {
      if (s.totalCost) totalCost += s.totalCost;
      if ((s as any).messageCount) totalMessages += (s as any).messageCount;
      if (s.totalInputTokens) totalInputTokens += s.totalInputTokens;
      if (s.totalOutputTokens) totalOutputTokens += s.totalOutputTokens;
    }

    return {
      totalCost,
      totalMessages,
      totalSessions: sessions.length,
      totalInputTokens,
      totalOutputTokens,
    };
  }, [sessions]);

  /** Format số tokens gọn (1500 → 1.5K, 2000000 → 2M) */
  const formatTokens = (n: number): string => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toString();
  };

  const latestSession = sessions.length > 0 ? sessions[0] : null;

  /** Format thời gian tương đối (vd: "5 phút trước") */
  const timeAgo = (isoDate: string): string => {
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Vừa xong';
    if (mins < 60) return `${mins} phút trước`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} giờ trước`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ngày trước`;
    return new Date(isoDate).toLocaleDateString('vi-VN');
  };

  /** Xoá phiên chat */
  const handleDeleteSession = async (sessionId: string) => {
    try {
      await sessionsApi.delete(sessionId);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      message.success('Đã xoá phiên chat');
    } catch {
      message.error('Không thể xoá phiên chat');
    }
  };

  if (loading) {
    return (
      <div className="proj-dash" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <Spin indicator={<LoadingOutlined style={{ fontSize: 32, color: 'var(--accent)' }} />} />
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="proj-dash">
      {/* ── Header: Thông tin dự án ── */}
      <div className="proj-dash-header">
        <div className="proj-dash-header-info">
          <div className="proj-dash-breadcrumb">
            <span className="proj-dash-breadcrumb-home" onClick={() => navigate('/')}>Dự án</span>
            <ArrowRightOutlined style={{ fontSize: 10, color: 'var(--text-muted)' }} />
            <span className="proj-dash-breadcrumb-current">{project.name}</span>
          </div>
          <Title level={3} style={{ color: '#fff', margin: '8px 0 4px' }}>
            {project.name}
          </Title>
          <div className="proj-dash-path">
            <FolderOpenOutlined style={{ flexShrink: 0 }} />
            <span>{project.path}</span>
          </div>
          {project.description && (
            <Paragraph style={{ color: 'var(--text-secondary)', marginTop: 8, marginBottom: 0, maxWidth: 600 }}>
              {project.description}
            </Paragraph>
          )}
        </div>

        {/* Quick Actions */}
        <div className="proj-dash-actions">
          {latestSession && (
            <button
              className="proj-dash-btn proj-dash-btn-resume"
              onClick={() => navigate(`/chat/${project.id}?sessionId=${latestSession.id}`)}
            >
              <PlayCircleOutlined />
              <span>Tiếp tục</span>
            </button>
          )}
          <button
            className="proj-dash-btn proj-dash-btn-new"
            onClick={() => navigate(`/chat/${project.id}`)}
          >
            <PlusOutlined />
            <span>Chat mới</span>
          </button>
        </div>
      </div>

      {/* ── Stats Grid ── */}
      <div className="proj-dash-stats">
        <div className="proj-dash-stat-card">
          <div className="proj-dash-stat-icon" style={{ background: 'rgba(81, 207, 102, 0.1)', color: '#51cf66' }}>
            <DollarOutlined />
          </div>
          <div className="proj-dash-stat-body">
            <div className="proj-dash-stat-value">${stats.totalCost.toFixed(4)}</div>
            <div className="proj-dash-stat-label">Tổng chi phí</div>
          </div>
        </div>

        <div className="proj-dash-stat-card">
          <div className="proj-dash-stat-icon" style={{ background: 'rgba(108, 92, 231, 0.1)', color: 'var(--accent)' }}>
            <MessageOutlined />
          </div>
          <div className="proj-dash-stat-body">
            <div className="proj-dash-stat-value">{stats.totalMessages.toLocaleString('vi-VN')}</div>
            <div className="proj-dash-stat-label">Tin nhắn</div>
          </div>
        </div>

        <div className="proj-dash-stat-card">
          <div className="proj-dash-stat-icon" style={{ background: 'rgba(255, 169, 64, 0.1)', color: '#ffa940' }}>
            <ThunderboltOutlined />
          </div>
          <div className="proj-dash-stat-body">
            <div className="proj-dash-stat-value">{stats.totalSessions}</div>
            <div className="proj-dash-stat-label">Phiên chat</div>
          </div>
        </div>

        {stats.totalInputTokens > 0 && (
          <div className="proj-dash-stat-card">
            <div className="proj-dash-stat-icon" style={{ background: 'rgba(23, 192, 235, 0.1)', color: '#17c0eb' }}>
              <ArrowUpOutlined />
            </div>
            <div className="proj-dash-stat-body">
              <div className="proj-dash-stat-value">{formatTokens(stats.totalInputTokens)}</div>
              <div className="proj-dash-stat-label">Input tokens</div>
            </div>
          </div>
        )}

        {stats.totalOutputTokens > 0 && (
          <div className="proj-dash-stat-card">
            <div className="proj-dash-stat-icon" style={{ background: 'rgba(255, 107, 107, 0.1)', color: '#ff6b6b' }}>
              <ArrowDownOutlined />
            </div>
            <div className="proj-dash-stat-body">
              <div className="proj-dash-stat-value">{formatTokens(stats.totalOutputTokens)}</div>
              <div className="proj-dash-stat-label">Output tokens</div>
            </div>
          </div>
        )}

        {(stats.totalInputTokens > 0 || stats.totalOutputTokens > 0) && (
          <div className="proj-dash-stat-card">
            <div className="proj-dash-stat-icon" style={{ background: 'rgba(108, 92, 231, 0.15)', color: 'var(--accent)' }}>
              <ThunderboltOutlined />
            </div>
            <div className="proj-dash-stat-body">
              <div className="proj-dash-stat-value">{formatTokens(stats.totalInputTokens + stats.totalOutputTokens)}</div>
              <div className="proj-dash-stat-label">Tổng tokens</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Session List ── */}
      <div className="proj-dash-section">
        <div className="proj-dash-section-header">
          <Text strong style={{ color: '#fff', fontSize: 15 }}>Lịch sử hội thoại</Text>
          <Text style={{ color: 'var(--text-muted)', fontSize: 12 }}>{sessions.length} phiên</Text>
        </div>

        {sessions.length === 0 ? (
          <div className="proj-dash-empty">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text style={{ color: 'var(--text-secondary)' }}>
                  Chưa có phiên chat nào. Bắt đầu ngay!
                </Text>
              }
            >
              <button
                className="proj-dash-btn proj-dash-btn-new"
                onClick={() => navigate(`/chat/${project.id}`)}
              >
                <PlusOutlined /> Bắt đầu Chat
              </button>
            </Empty>
          </div>
        ) : (
          <div className="proj-dash-session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="proj-dash-session-card"
              >
                <div
                  className="proj-dash-session-left"
                  onClick={() => navigate(`/chat/${project.id}?sessionId=${session.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="proj-dash-session-index">
                    <MessageOutlined />
                  </div>
                  <div className="proj-dash-session-info">
                    <div className="proj-dash-session-name">
                      {session.name || `Phiên ${new Date(session.createdAt).toLocaleDateString('vi-VN')} — ${new Date(session.createdAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`}
                    </div>
                    <div className="proj-dash-session-meta">
                      {session.model && (
                        <Tooltip title="Model">
                          <span className="proj-dash-session-tag">
                            <RobotOutlined /> {session.model}
                          </span>
                        </Tooltip>
                      )}
                      {(session as any).messageCount > 0 && (
                        <span className="proj-dash-session-tag">
                          <MessageOutlined /> {(session as any).messageCount}
                        </span>
                      )}
                      {session.totalCost != null && session.totalCost > 0 && (
                        <span className="proj-dash-session-tag">
                          <DollarOutlined /> ${session.totalCost.toFixed(4)}
                        </span>
                      )}
                      {(session.totalInputTokens || session.totalOutputTokens) && (
                        <Tooltip title={`Input: ${(session.totalInputTokens || 0).toLocaleString()} · Output: ${(session.totalOutputTokens || 0).toLocaleString()}`}>
                          <span className="proj-dash-session-tag">
                            <ThunderboltOutlined /> {formatTokens((session.totalInputTokens || 0) + (session.totalOutputTokens || 0))}
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                </div>
                <div className="proj-dash-session-right">
                  <span className="proj-dash-session-time">
                    <ClockCircleOutlined /> {timeAgo(session.updatedAt)}
                  </span>
                  <Popconfirm
                    title="Xoá phiên chat này?"
                    description="Tin nhắn và dữ liệu liên quan sẽ bị xoá vĩnh viễn."
                    onConfirm={() => handleDeleteSession(session.id)}
                    okText="Xoá"
                    cancelText="Huỷ"
                    okButtonProps={{ danger: true }}
                  >
                    <button
                      type="button"
                      className="proj-dash-session-delete-btn"
                      aria-label="Xoá phiên chat"
                    >
                      <DeleteOutlined className="proj-dash-session-delete" />
                    </button>
                  </Popconfirm>
                  <ArrowRightOutlined className="proj-dash-session-arrow" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProjectDashboard;
