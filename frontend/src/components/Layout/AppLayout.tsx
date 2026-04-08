import React, { useState, useEffect } from 'react';
import { Layout, Menu, Typography, Tag, Button, Tooltip } from 'antd';
import {
  MessageOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  FolderOpenOutlined,
  ProjectOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation } from 'react-router-dom';
import { sessionsApi, projectsApi } from '../../services/api';
import type { ChatSession, Project } from '../../types';

const { Sider, Content, Header } = Layout;
const { Text } = Typography;

interface AppLayoutProps {
  children: React.ReactNode;
  isConnected: boolean;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children, isConnected }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Fetch sessions and projects periodically or on location change
    const fetchData = async () => {
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
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [location.pathname]);

  // Build menu items grouped by project
  const menuItems = projects.map(proj => {
    const projSessions = sessions.filter(s => s.projectId === proj.id);
    return {
      key: `proj-${proj.id}`,
      icon: <ProjectOutlined />,
      label: proj.name,
      children: [
        {
          key: `/chat/${proj.id}?new=true`,
          icon: <PlusOutlined />,
          label: 'Cuộc trò chuyện mới',
          onClick: () => navigate(`/chat/${proj.id}?new=true`),
        },
        ...projSessions.map(session => ({
          key: `/chat/${proj.id}?sessionId=${session.id}`,
          icon: <MessageOutlined />,
          label: session.name || `Phiên ${new Date(session.createdAt).toLocaleTimeString('vi-VN')}`,
          onClick: () => navigate(`/chat/${proj.id}?sessionId=${session.id}`),
        }))
      ]
    };
  });

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        theme="dark"
        width={260}
        style={{
          background: 'linear-gradient(180deg, #0a0a0f 0%, #12121a 100%)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            gap: 8,
            cursor: 'pointer',
          }}
          onClick={() => navigate('/')}
        >
          <ThunderboltOutlined style={{ fontSize: 24, color: '#6c5ce7' }} />
          {!collapsed && (
            <Text strong style={{ color: '#fff', fontSize: 16, letterSpacing: 1 }}>
              Claude Web
            </Text>
          )}
        </div>
        <div style={{ padding: '12px 0', height: 'calc(100vh - 120px)', overflowY: 'auto' }}>
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
        <div style={{ position: 'absolute', bottom: 0, width: '100%', padding: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <Menu
            theme="dark"
            mode="inline"
            selectable={false}
            items={[
              {
                key: 'settings',
                icon: <SettingOutlined />,
                label: 'Cài đặt',
                onClick: () => navigate('/settings'),
              }
            ]}
            style={{ background: 'transparent' }}
          />
        </div>
      </Sider>
      <Layout>
        <Header
          style={{
            background: 'rgba(10, 10, 15, 0.8)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 48,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <Tooltip title="Quản lý Dự án">
              <Button 
                type="text" 
                icon={<FolderOpenOutlined style={{ color: 'rgba(255,255,255,0.65)', fontSize: 16 }} />} 
                onClick={() => navigate('/')}
              />
            </Tooltip>
          </div>
          <Tag
            color={isConnected ? 'green' : 'red'}
            style={{
              borderRadius: 12,
              fontSize: 11,
              padding: '0 10px',
            }}
          >
            {isConnected ? '● Connected' : '○ Disconnected'}
          </Tag>
        </Header>
        <Content
          style={{
            background: '#0f0f17',
            minHeight: 'calc(100vh - 48px)',
          }}
        >
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
