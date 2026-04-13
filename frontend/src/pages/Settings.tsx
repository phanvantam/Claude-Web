import React from 'react';
import { Card, Tabs, Typography } from 'antd';
import {
  SettingOutlined,
  ThunderboltOutlined,
  CodeOutlined,
  ExperimentOutlined,
  GlobalOutlined,
  CloudServerOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import QuickConfigTab from './Settings/QuickConfigTab';
import WebConfigJsonTab from './Settings/WebConfigJsonTab';
import CliSettingsJsonTab from './Settings/CliSettingsJsonTab';
import McpServersTab from './Settings/McpServersTab';
import AgentsTab from './Settings/AgentsTab';
import SkillsTab from './Settings/SkillsTab';

const { Title, Text } = Typography;

const Settings: React.FC = () => {
  const tabItems = [
    {
      key: 'quick',
      label: (
        <span>
          <ThunderboltOutlined style={{ marginRight: 6 }} />
          Cấu hình nhanh
        </span>
      ),
      children: (
        <Card className="glass-card">
          <QuickConfigTab />
        </Card>
      ),
    },
    {
      key: 'web-json',
      label: (
        <span>
          <CodeOutlined style={{ marginRight: 6 }} />
          Web Config (JSON)
        </span>
      ),
      children: (
        <Card className="glass-card">
          <WebConfigJsonTab />
        </Card>
      ),
    },
    {
      key: 'skills',
      label: (
        <span>
          <ExperimentOutlined style={{ marginRight: 6 }} />
          Kỹ năng (Skills)
        </span>
      ),
      children: (
        <Card className="glass-card">
          <SkillsTab />
        </Card>
      ),
    },
    {
      key: 'cli-json',
      label: (
        <span>
          <GlobalOutlined style={{ marginRight: 6 }} />
          Claude CLI (JSON)
        </span>
      ),
      children: (
        <Card className="glass-card">
          <CliSettingsJsonTab />
        </Card>
      ),
    },
    {
      key: 'mcp',
      label: (
        <span>
          <CloudServerOutlined style={{ marginRight: 6 }} />
          MCP Servers
        </span>
      ),
      children: (
        <Card className="glass-card">
          <McpServersTab />
        </Card>
      ),
    },
    {
      key: 'agents',
      label: (
        <span>
          <RobotOutlined style={{ marginRight: 6 }} />
          Agents
        </span>
      ),
      children: (
        <Card className="glass-card">
          <AgentsTab />
        </Card>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            <SettingOutlined style={{ marginRight: 8, color: '#6c5ce7' }} />
            Cấu hình chung
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.4)' }}>
            Thiết lập cấu hình mặc định cho Claude CLI & ứng dụng Web
          </Text>
        </div>
      </div>

      <Tabs
        defaultActiveKey="quick"
        items={tabItems}
        type="card"
        className="settings-tabs"
      />
    </div>
  );
};

export default Settings;
