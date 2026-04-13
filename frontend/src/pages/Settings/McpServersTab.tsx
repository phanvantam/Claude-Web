import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Button, Spin, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { claudeApi } from '../../services/api';

const McpServersTab: React.FC = () => {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    claudeApi.getMcpServers().then((raw) => {
      try {
        const parsed = JSON.parse(raw.content);
        setValue(JSON.stringify(parsed, null, 2));
      } catch {
        setValue(raw.content);
      }
      setLoading(false);
    }).catch(() => {
      message.error('Không thể tải cấu hình MCP Servers');
      setLoading(false);
    });
  }, []);

  const handleEditorChange = useCallback((val: string | undefined) => {
    const v = val || '';
    setValue(v);
    try {
      JSON.parse(v);
      setParseError(null);
    } catch (e: any) {
      setParseError(e.message);
    }
  }, []);

  const handleSave = async () => {
    try {
      JSON.parse(value);
      setSaving(true);
      await claudeApi.updateMcpServers(value);
      message.success('Đã lưu cấu hình MCP Servers');
    } catch (e: any) {
      if (e instanceof SyntaxError) {
        message.error('JSON không hợp lệ');
      } else {
        message.error(`Lỗi: ${e.message}`);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Spin spinning={loading}>
      <Alert
        title="MCP Servers — ~/.claude.json"
        description="Cấu hình các Model Context Protocol servers. Mỗi server cần có command, args, và type (stdio/sse). Thay đổi sẽ ghi trực tiếp vào trường mcpServers trong file ~/.claude.json."
        type="info"
        showIcon
        style={{ marginBottom: 16, background: 'rgba(0,206,209,0.06)', border: '1px solid rgba(0,206,209,0.2)' }}
      />

      {parseError && (
        <Alert
          title="Lỗi JSON"
          description={parseError}
          type="error"
          showIcon
          style={{ marginBottom: 12 }}
        />
      )}

      <div style={{
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 16,
      }}>
        <Editor
          height="500px"
          language="json"
          theme="vs-dark"
          value={value}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            wordWrap: 'on',
            tabSize: 2,
            formatOnPaste: true,
          }}
        />
      </div>

      <Button
        type="primary"
        icon={<SaveOutlined />}
        loading={saving}
        disabled={!!parseError}
        onClick={handleSave}
        className="primary-btn"
        size="large"
      >
        Lưu MCP Servers
      </Button>
    </Spin>
  );
};

export default McpServersTab;
