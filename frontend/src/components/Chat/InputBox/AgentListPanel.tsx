import React from 'react';
import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { AgentInfo } from './types';

interface AgentListPanelProps {
  menuRef: React.RefObject<HTMLDivElement | null>;
  agents: AgentInfo[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (name: string) => void;
}

const AgentListPanel: React.FC<AgentListPanelProps> = ({
  menuRef,
  agents,
  activeIndex,
  onHover,
  onSelect,
}) => {
  return (
    <div className="slash-menu agent-list-panel" ref={menuRef}>
      <div className="slash-menu-title">Agents</div>
      {agents.map((agent, i) => (
        <div
          key={`${agent.scope || 'user'}-${agent.name}`}
          className={`slash-item ${i === activeIndex ? 'active' : ''}`}
          onClick={() => onSelect(agent.name)}
          onMouseEnter={() => onHover(i)}
        >
          <span className="slash-cmd">@{agent.name}</span>
          <span className="slash-desc slash-desc-truncate">{agent.description || agent.name}</span>
          {agent.scope && agent.scope !== 'user' && (
            <span className="slash-source">{agent.scope}</span>
          )}
          {agent.description && (
            <Tooltip
              title={(
                <span>
                  {agent.description}
                  {agent.model && (
                    <span style={{ display: 'block', marginTop: 4, color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>
                      Model: {agent.model}
                    </span>
                  )}
                  {agent.tools && agent.tools.length > 0 && (
                    <span style={{ display: 'block', marginTop: 2, color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                      Tools: {agent.tools.join(', ')}
                    </span>
                  )}
                </span>
              )}
              trigger={['hover', 'click']}
              placement="left"
              mouseEnterDelay={0.2}
              styles={{ root: { maxWidth: 280 } }}
            >
              <QuestionCircleOutlined
                className="agent-desc-help"
                onClick={(e) => e.stopPropagation()}
              />
            </Tooltip>
          )}
        </div>
      ))}
    </div>
  );
};

export default AgentListPanel;
