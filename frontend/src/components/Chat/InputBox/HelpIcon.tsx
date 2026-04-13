import React from 'react';
import { Popover } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';

function HelpIcon({ title, desc }: { title: string; desc: React.ReactNode }) {
  return (
    <Popover
      content={
        <div style={{ maxWidth: 260 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>{desc}</div>
        </div>
      }
      trigger="hover"
      placement="right"
      mouseEnterDelay={0.3}
    >
      <QuestionCircleOutlined
        className="menu-item-help"
        onClick={(e) => e.stopPropagation()}
      />
    </Popover>
  );
}

export default HelpIcon;
