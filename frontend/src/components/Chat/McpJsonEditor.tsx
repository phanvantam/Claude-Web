/**
 * Editor JSON inline cho MCP servers config.
 * Hiển thị textarea + nút Lưu/Hủy khi user bấm "Sửa" trong MCP drawer.
 *
 * Tách từ McpStatusPopover.tsx.
 */

import React from 'react';
import { Button, Input } from 'antd';
import {
  InfoCircleFilled,
  SaveOutlined,
  CloseOutlined,
} from '@ant-design/icons';

interface McpJsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}

/** Editor JSON inline với tip và nút action */
const McpJsonEditor: React.FC<McpJsonEditorProps> = ({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
}) => (
  <div className="mcp-editor">
    <div className="mcp-editor-tip">
      <InfoCircleFilled style={{ fontSize: 11, color: '#f1c40f' }} />
      <span>Tối ưu: Nên cài Tool qua <b>npm install -g</b> và gọi lệnh trực tiếp thay vì <b>npx</b> để startup nhanh hơn (~0.2s).</span>
    </div>
    <Input.TextArea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoSize={{ minRows: 8, maxRows: 20 }}
      className="mcp-editor-textarea"
      spellCheck={false}
      placeholder='{ "server-name": { "command": "npx", "args": ["..."], "type": "stdio" } }'
    />
    <div className="mcp-editor-actions">
      <Button
        size="small"
        icon={<CloseOutlined />}
        onClick={onCancel}
      >
        Hủy
      </Button>
      <Button
        type="primary"
        size="small"
        icon={<SaveOutlined />}
        onClick={onSave}
        loading={saving}
      >
        Lưu
      </Button>
    </div>
  </div>
);

export default McpJsonEditor;
