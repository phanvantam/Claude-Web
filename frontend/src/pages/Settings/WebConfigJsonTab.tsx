import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Button, Spin, message } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { configApi } from '../../services/api';

const WebConfigJsonTab: React.FC = () => {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    configApi.get().then((config) => {
      setValue(JSON.stringify(config, null, 2));
      setLoading(false);
    }).catch(() => {
      message.error('Không thể tải cấu hình');
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
      const parsed = JSON.parse(value);
      setSaving(true);
      await configApi.update(parsed);
      message.success('Đã lưu cấu hình Web');
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
        title="Cấu hình nội bộ của ứng dụng Web"
        description="Chỉnh sửa trực tiếp đối tượng GlobalConfig (model, permissionMode, customArgs, maxBudgetUsd,...). Trường customArgs cho phép truyền thêm flags dòng lệnh cho Claude CLI."
        type="info"
        showIcon
        style={{ marginBottom: 16, background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)' }}
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
          height="400px"
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
        Lưu cấu hình Web
      </Button>
    </Spin>
  );
};

export default WebConfigJsonTab;
