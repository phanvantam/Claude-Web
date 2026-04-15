import React, { useState, useEffect, useCallback } from 'react';
import { Layout, Menu, Typography, Button, Tooltip, Drawer } from 'antd';
import {
  MessageOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  FolderOpenOutlined,
  ProjectOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SyncOutlined,
  CheckCircleFilled,
  CloseOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { sessionsApi, projectsApi } from '../../services/api';
import { socketService } from '../../services/socket';
import { useSessionsStatus } from '../../hooks/useSessionsStatus';
import type { ChatSession, Project } from '../../types';

const { Sider, Content } = Layout;
const { Text } = Typography;

/** Breakpoint mobile — giữ đồng bộ với CSS @media */
const MOBILE_BREAKPOINT = 768;

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  /** Drawer sidebar trên mobile — chỉ dùng khi viewport nhỏ */
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { isProcessing, isUnread } = useSessionsStatus();

  // Để viewport thay đổi, vd: xoay màn hình
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Tự đóng drawer khi navigate
  useEffect(() => {
    if (isMobile) setMobileDrawerOpen(false);
  }, [location.pathname, location.search, isMobile]);

  const fetchData = useCallback(async () => {
    try {
      const [sessData, projData] = await Promise.all([
        sessionsApi.getAll(),
        projectsApi.getAll()
      ]);
      setSessions(sessData);
      setProjects(projData);
    } catch (err) {
      console.error('Failed to load data', err);
    }
  }, []);

  useEffect(() => {
    fetchData();

    // Poll mỗi 5 giây để đồng bộ trạng thái
    const interval = setInterval(fetchData, 5000);

    // Lắng nghe WebSocket — refetch ngay khi có session mới hoặc kết thúc
    const socket = socketService.connect();
    const handleSessionChange = () => fetchData();
    socket.on('global:session_created', handleSessionChange);
    socket.on('session:ended', handleSessionChange);

    return () => {
      clearInterval(interval);
      socket.off('global:session_created', handleSessionChange);
      socket.off('session:ended', handleSessionChange);
      socketService.release();
    };
  }, [fetchData]);

  // Refetch khi navigate (ví dụ: vào session mới)
  useEffect(() => {
    fetchData();
  }, [location.pathname, fetchData]);

  /**
   * Tạo icon cho session dựa trên trạng thái:
   * 1. Đang xử lý → icon xoay (SyncOutlined spin) màu vàng
   * 2. Đã xong & chưa đọc → tick xanh (CheckCircleFilled)
   * 3. Bình thường → icon tin nhắn (MessageOutlined)
   */
  const getSessionIcon = (session: ChatSession) => {
    if (isProcessing(session.id)) {
      return (
        <Tooltip title="Đang xử lý...">
          <SyncOutlined spin style={{ color: '#fdcb6e', fontSize: 14 }} />
        </Tooltip>
      );
    }

    if (isUnread(session.id, session.updatedAt)) {
      return (
        <Tooltip title="Có phản hồi mới">
          <CheckCircleFilled style={{ color: '#52c41a', fontSize: 14 }} />
        </Tooltip>
      );
    }

    return <MessageOutlined />;
  };

  // Build menu items grouped by project
  const menuItems = projects.map(proj => {
    const projSessions = sessions.filter(s => s.projectId === proj.id);

    // Kiểm tra xem project có session nào đang chạy không
    const hasProcessing = projSessions.some(s => isProcessing(s.id));

    return {
      key: `proj-${proj.id}`,
      icon: hasProcessing
        ? <SyncOutlined spin style={{ color: '#fdcb6e' }} />
        : projSessions.length > 0
          ? (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 18,
              height: 18,
              borderRadius: 4,
              background: 'rgba(108,92,231,0.25)',
              color: 'rgba(108,92,231,1)',
              fontSize: 11,
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1,
            }}>
              {projSessions.length}
            </span>
          )
          : <ProjectOutlined />,
      label: proj.name,
      children: [
        {
          key: `/project/${proj.id}`,
          icon: <FolderOpenOutlined />,
          label: 'Tổng quan',
          onClick: () => navigate(`/project/${proj.id}`),
        },
        ...projSessions.map(session => ({
          key: `/chat/${proj.id}?sessionId=${session.id}`,
          icon: getSessionIcon(session),
          label: (
            <span style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontWeight: isUnread(session.id, session.updatedAt) ? 600 : 400,
            }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {session.name || `Phiên ${new Date(session.createdAt).toLocaleTimeString('vi-VN')}`}
              </span>
              {(session.messageCount ?? 0) > 0 && (
                <span style={{
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.3)',
                  marginLeft: 6,
                  flexShrink: 0,
                }}>
                  {session.messageCount}
                </span>
              )}
            </span>
          ),
          onClick: () => navigate(`/chat/${proj.id}?sessionId=${session.id}`),
        }))
      ]
    };
  });

  /** Bottom menu — dùng chung cho PC và mobile */
  const bottomMenuItems = [
    {
      key: 'du-an',
      icon: <FolderOpenOutlined />,
      label: 'Dự án',
      onClick: () => navigate('/'),
    },
    {
      key: 'settings',
      icon: <SettingOutlined />,
      label: 'Cài đặt',
      onClick: () => navigate('/settings'),
    }
  ];

  /** Sidebar content — render 1 lần, dùng cho cả Sider (PC) và Drawer (mobile) */
  const sidebarContent = (
    <>
      <div style={{ padding: '12px 0', paddingBottom: 140, height: 'calc(100vh - 64px)', overflowY: 'auto', flex: 1 }}>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[location.pathname + location.search]}
          defaultOpenKeys={projects.map(p => `proj-${p.id}`)}
          items={menuItems}
          style={{
            background: 'transparent',
            borderRight: 'none',
          }}
        />
      </div>
      <div style={{
        position: 'absolute',
        bottom: 0,
        width: '100%',
        padding: '8px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(18, 18, 28, 0.95)',
        backdropFilter: 'blur(8px)',
      }}>
        <Menu
          theme="dark"
          mode="inline"
          selectable={false}
          items={bottomMenuItems}
          style={{ background: 'transparent' }}
        />
      </div>
    </>
  );

  // ── MOBILE: Drawer + hamburger trên header ──
  if (isMobile) {
    return (
      <Layout style={{ minHeight: '100vh' }}>
        {/* Mobile header bar — chứa hamburger + logo */}
        <div className="mobile-header">
          <Button
            type="text"
            icon={<MenuUnfoldOutlined />}
            onClick={() => setMobileDrawerOpen(true)}
            className="mobile-hamburger"
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ThunderboltOutlined style={{ fontSize: 20, color: '#6c5ce7' }} />
            <Text strong style={{ color: '#fff', fontSize: 15, letterSpacing: 1 }}>
              Claude Web
            </Text>
          </div>
          {/* Spacer để logo nằm giữa */}
          <div style={{ width: 32 }} />
        </div>

        {/* Drawer sidebar — trượt từ trái */}
        <Drawer
          placement="left"
          open={mobileDrawerOpen}
          onClose={() => setMobileDrawerOpen(false)}
          closeIcon={<CloseOutlined style={{ color: 'rgba(255,255,255,0.5)' }} />}
          styles={{
            wrapper: { width: 280 },
            header: {
              background: 'linear-gradient(180deg, #0a0a0f 0%, #12121a 100%)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              padding: '16px',
            },
            body: {
              background: 'linear-gradient(180deg, #0a0a0f 0%, #12121a 100%)',
              padding: 0,
              position: 'relative',
              overflow: 'hidden',
            },
          }}
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ThunderboltOutlined style={{ fontSize: 20, color: '#6c5ce7' }} />
              <Text strong style={{ color: '#fff', fontSize: 15, letterSpacing: 1 }}>
                Claude Web
              </Text>
            </div>
          }
        >
          {sidebarContent}
        </Drawer>

        <Content
          style={{
            background: '#0f0f17',
            height: 'calc(100vh - 48px)',
            height: 'calc(100dvh - 48px)',
            /* Fix iOS Safari: dùng height thay minHeight, dùng dvh thay vh */
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {children}
        </Content>
      </Layout>
    );
  }

  // ── DESKTOP: Sider cố định bên trái ──
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        width={260}
        trigger={null}
        style={{
          background: 'linear-gradient(180deg, #0a0a0f 0%, #12121a 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          height: '100vh',
          position: 'sticky',
          top: 0,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'space-between',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            padding: collapsed ? '0' : '0 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: 'pointer',
            }}
            onClick={() => collapsed ? setCollapsed(false) : navigate('/')}
          >
            <ThunderboltOutlined style={{ fontSize: 24, color: '#6c5ce7' }} />
            {!collapsed && (
              <Text strong style={{ color: '#fff', fontSize: 16, letterSpacing: 1 }}>
                Claude Web
              </Text>
            )}
          </div>
          {!collapsed && (
            <Button
              type="text"
              icon={<MenuFoldOutlined />}
              onClick={() => setCollapsed(true)}
              style={{ color: 'rgba(255,255,255,0.5)' }}
            />
          )}
        </div>
        {sidebarContent}
      </Sider>
      <Layout>
        <Content
          style={{
            background: '#0f0f17',
            minHeight: '100vh',
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
