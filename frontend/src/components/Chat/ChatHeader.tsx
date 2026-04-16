import React from 'react';
import { Button, Popover, Badge, Tooltip, Dropdown, Popconfirm } from 'antd';
import type { MenuProps } from 'antd';
import {
  FolderOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  InfoCircleOutlined,
  DeleteOutlined,
  MoreOutlined,
  ApiOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import McpStatusPopover from './McpStatusPopover';
import type { Project } from '../../types';
import type { McpRuntimeServer } from '../../hooks/useChat';

interface ChatHeaderProps {
  projectId?: string;
  project: Project | null;
  skillCount: number;
  onOpenSkillDrawer: () => void;
  mcpRuntimeStatus: McpRuntimeServer[];
  onRefreshMcp: () => void;
  subAgentCount: number;
  onOpenSubAgentDrawer: () => void;
  statsContent: React.ReactNode;
  onClearMessages: () => void;
  onDeleteSession: () => void;
  planCount: number;
  onOpenPlanDrawer: () => void;
  onNavigateToProject: (projectId?: string) => void;
}

/**
 * Header hội thoại — hiện đầy đủ nút trên desktop,
 * thu gọn vào Dropdown trên mobile (≤768px) để tiết kiệm diện tích.
 */
const ChatHeader: React.FC<ChatHeaderProps> = ({
  projectId,
  project,
  skillCount,
  onOpenSkillDrawer,
  mcpRuntimeStatus,
  onRefreshMcp,
  subAgentCount,
  onOpenSubAgentDrawer,
  statsContent,
  onClearMessages,
  onDeleteSession,
  planCount,
  onOpenPlanDrawer,
  onNavigateToProject,
}) => {
  // Số MCP server đang connected — dùng để hiển thị badge trong dropdown
  const mcpConnectedCount = mcpRuntimeStatus.filter(s => s.status === 'connected').length;

  // Menu items cho Dropdown trên mobile
  const mobileMenuItems: MenuProps['items'] = [
    {
      key: 'skills',
      icon: <ThunderboltOutlined style={{ color: skillCount > 0 ? '#e17055' : undefined }} />,
      label: `Skills${skillCount > 0 ? ` (${skillCount})` : ''}`,
      onClick: onOpenSkillDrawer,
    },
    {
      key: 'mcp',
      icon: <ApiOutlined style={{ color: mcpConnectedCount > 0 ? '#00b894' : undefined }} />,
      label: `MCP Servers${mcpConnectedCount > 0 ? ` (${mcpConnectedCount})` : ''}`,
      onClick: onRefreshMcp,
    },
    {
      key: 'subagents',
      icon: <RobotOutlined style={{ color: subAgentCount > 0 ? 'var(--accent)' : undefined }} />,
      label: `Sub Agents${subAgentCount > 0 ? ` (${subAgentCount})` : ''}`,
      onClick: onOpenSubAgentDrawer,
    },
    {
      key: 'plan',
      icon: <FileTextOutlined style={{ color: planCount > 0 ? '#00b894' : undefined }} />,
      label: `Kế hoạch${planCount > 0 ? ` (${planCount})` : ''}`,
      onClick: onOpenPlanDrawer,
    },
    { type: 'divider' },
    {
      key: 'clear',
      icon: <DeleteOutlined />,
      label: 'Xóa tin nhắn',
      onClick: onClearMessages,
      danger: false,
    },
    {
      key: 'delete-session',
      icon: <DeleteOutlined />,
      label: 'Xóa cuộc hội thoại',
      onClick: onDeleteSession,
      danger: true,
    },
  ];

  // Tổng badge count để hiện trên nút More (cho user biết có item active)
  const totalBadgeCount = skillCount + subAgentCount + mcpConnectedCount + planCount;

  return (
    <div className="chat-header">
      <div className="chat-header-left" onClick={() => onNavigateToProject(projectId)}>
        <FolderOutlined style={{ color: 'var(--accent)', fontSize: 14, flexShrink: 0 }} />
        <span className="chat-header-path" title={project?.path}>
          {project?.path || 'Loading...'}
        </span>
      </div>

      {/* Desktop: hiện đầy đủ từng nút */}
      <div className="chat-header-actions-desktop">
        <Badge count={skillCount} size="small" offset={[-4, 4]} style={{ backgroundColor: '#e17055' }}>
          <Tooltip title="Skills">
            <Button
              type="text"
              icon={<ThunderboltOutlined />}
              onClick={onOpenSkillDrawer}
              style={{ color: skillCount > 0 ? '#e17055' : 'rgba(255,255,255,0.4)' }}
              size="small"
            />
          </Tooltip>
        </Badge>

        <McpStatusPopover projectId={project?.id} runtimeStatus={mcpRuntimeStatus} onRefreshMcp={onRefreshMcp} />

        <Badge count={subAgentCount} size="small" offset={[-4, 4]} style={{ backgroundColor: 'var(--accent)' }}>
          <Button
            type="text"
            icon={<RobotOutlined />}
            onClick={onOpenSubAgentDrawer}
            style={{ color: subAgentCount > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.4)' }}
            size="small"
            title="Sub Agents"
          />
        </Badge>

        <Badge count={planCount} size="small" offset={[-4, 4]} style={{ backgroundColor: '#00b894' }}>
          <Tooltip title="Kế hoạch">
            <Button
              type="text"
              icon={<FileTextOutlined />}
              onClick={onOpenPlanDrawer}
              style={{ color: planCount > 0 ? '#00b894' : 'rgba(255,255,255,0.4)' }}
              size="small"
            />
          </Tooltip>
        </Badge>

        <Popover content={statsContent} trigger="click" placement="bottomRight">
          <Button
            type="text"
            icon={<InfoCircleOutlined />}
            style={{ color: 'rgba(255,255,255,0.4)' }}
            size="small"
          />
        </Popover>

        <Popconfirm
          title="Xóa cuộc hội thoại này?"
          description="Tin nhắn và dữ liệu liên quan sẽ bị xoá vĩnh viễn."
          onConfirm={onDeleteSession}
          okText="Xóa"
          cancelText="Huỷ"
          okButtonProps={{ danger: true }}
        >
          <Button
            type="text"
            icon={<DeleteOutlined />}
            style={{ color: 'rgba(255,255,255,0.4)' }}
            title="Xóa cuộc hội thoại"
            size="small"
          />
        </Popconfirm>
      </div>

      {/* Mobile: thu gọn vào Dropdown */}
      <div className="chat-header-actions-mobile">
        {/* Giữ lại nút Info (Stats) vì cần Popover riêng */}
        <Popover content={statsContent} trigger="click" placement="bottomRight">
          <Button
            type="text"
            icon={<InfoCircleOutlined />}
            style={{ color: 'rgba(255,255,255,0.4)' }}
            size="small"
          />
        </Popover>

        <Dropdown
          menu={{ items: mobileMenuItems }}
          trigger={['click']}
          placement="bottomRight"
          overlayClassName="chat-header-mobile-dropdown"
        >
          <Badge count={totalBadgeCount} size="small" offset={[-4, 4]} style={{ backgroundColor: 'var(--accent)' }}>
            <Button
              type="text"
              icon={<MoreOutlined />}
              style={{ color: 'rgba(255,255,255,0.6)', fontSize: 18 }}
              size="small"
            />
          </Badge>
        </Dropdown>
      </div>
    </div>
  );
};

export default ChatHeader;
