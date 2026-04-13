import React from 'react';
import { Button, Popover, Badge, Tooltip } from 'antd';
import {
  FolderOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  InfoCircleOutlined,
  DeleteOutlined,
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
  onNavigateToProject: (projectId?: string) => void;
}

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
  onNavigateToProject,
}) => {
  return (
    <div className="chat-header">
      <div className="chat-header-left" onClick={() => onNavigateToProject(projectId)}>
        <FolderOutlined style={{ color: 'var(--accent)', fontSize: 14, flexShrink: 0 }} />
        <span className="chat-header-path" title={project?.path}>
          {project?.path || 'Loading...'}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
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

        <Popover content={statsContent} trigger="click" placement="bottomRight">
          <Button
            type="text"
            icon={<InfoCircleOutlined />}
            style={{ color: 'rgba(255,255,255,0.4)' }}
            size="small"
          />
        </Popover>

        <Button
          type="text"
          icon={<DeleteOutlined />}
          onClick={onClearMessages}
          style={{ color: 'rgba(255,255,255,0.4)' }}
          title="Xóa tin nhắn"
          size="small"
        />
      </div>
    </div>
  );
};

export default ChatHeader;
