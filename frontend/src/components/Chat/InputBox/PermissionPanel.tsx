import React from 'react';
import { Popover } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, LockOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { PendingPermission } from '../../../hooks/useChat';
import { getToolDescription } from './constants';

const PermissionPanel: React.FC<{
  pendingPermission: PendingPermission;
  onRespondPermission?: (allowed: boolean) => void;
}> = ({ pendingPermission, onRespondPermission }) => {
  return (
    <div className="permission-panel">
      <div className="permission-panel-header">
        <LockOutlined className="permission-panel-icon" />
        <span className="permission-panel-title">Xác nhận quyền</span>
      </div>
      <div className="permission-panel-body">
        <p className="permission-panel-desc">
          Claude muốn sử dụng tool:{' '}
          <strong style={{ color: 'var(--accent)' }}>{pendingPermission.toolName}</strong>
          {(() => {
            const desc = getToolDescription(pendingPermission.toolName);
            if (!desc) return null;
            return (
              <Popover
                content={<span style={{ fontSize: 12, maxWidth: 260, display: 'block' }}>{desc}</span>}
                trigger="hover"
                placement="top"
              >
                <QuestionCircleOutlined className="permission-tool-help" />
              </Popover>
            );
          })()}
        </p>
        <pre className="permission-panel-code">
          {JSON.stringify(pendingPermission.input, null, 2)}
        </pre>
      </div>
      <div className="permission-panel-actions">
        <button
          className="permission-btn permission-btn-deny"
          onClick={() => onRespondPermission?.(false)}
        >
          <CloseCircleOutlined /> Từ chối
        </button>
        <button
          className="permission-btn permission-btn-allow"
          onClick={() => onRespondPermission?.(true)}
        >
          <CheckCircleOutlined /> Cho phép
        </button>
      </div>
    </div>
  );
};

export default PermissionPanel;
