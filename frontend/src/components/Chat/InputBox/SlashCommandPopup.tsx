import React from 'react';
import { Tooltip } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

export type SlashPopupItem = {
  key: string;
  cmd: string;
  desc: string;
  source?: string;
  onSelect: () => void;
  onHover: () => void;
  helpContent?: React.ReactNode;
};

const SlashCommandPopup: React.FC<{
  title: string;
  items: SlashPopupItem[];
  activeIndex: number;
  menuRef: React.RefObject<HTMLDivElement | null>;
}> = ({ title, items, activeIndex, menuRef }) => {
  return (
    <div className="slash-menu" ref={menuRef}>
      <div className="slash-menu-title">{title}</div>
      {items.map((item, i) => (
        <div
          key={item.key}
          className={`slash-item ${i === activeIndex ? 'active' : ''}`}
          onClick={item.onSelect}
          onMouseEnter={item.onHover}
        >
          <span className="slash-cmd">{item.cmd}</span>
          <span className="slash-desc slash-desc-truncate">{item.desc}</span>
          {item.source && (
            <span className="slash-source">{item.source}</span>
          )}
          {item.helpContent && (
            <Tooltip
              title={item.helpContent}
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

export default SlashCommandPopup;
