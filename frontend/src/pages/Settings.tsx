import React, { useEffect, useState, useCallback } from 'react';
import {
  Card,
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Typography,
  message,
  Divider,
  Tabs,
  Space,
  Alert,
  Spin,
  Tooltip,
} from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  ThunderboltOutlined,
  CodeOutlined,
  GlobalOutlined,
  ApiOutlined,
  TranslationOutlined,
  ExperimentOutlined,
  InfoCircleOutlined,
  CloudServerOutlined,
  RobotOutlined,
  PlusOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { configApi, claudeApi } from '../services/api';
import type { GlobalConfig } from '../types';

const { Title, Text } = Typography;

// ============================
// Tab 1: Cấu hình nhanh (UI Form)
// ============================
const QuickConfigTab: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Cấu hình Claude CLI gốc (language, effortLevel, env)
  const [cliSettings, setCliSettings] = useState<Record<string, any>>({});
  const [cliLoading, setCliLoading] = useState(true);

  useEffect(() => {
    // Tải song song: config web + settings CLI
    Promise.all([
      configApi.get(),
      claudeApi.getRawSettings(),
    ]).then(([webConfig, raw]) => {
      form.setFieldsValue(webConfig);

      try {
        const parsed = JSON.parse(raw.content);
        setCliSettings(parsed);
        // Đặt giá trị CLI vào form
        form.setFieldsValue({
          cli_language: parsed.language || '',
          cli_effortLevel: parsed.effortLevel || 'high',
          cli_baseUrl: parsed.env?.ANTHROPIC_BASE_URL || '',
          cli_authToken: parsed.env?.ANTHROPIC_AUTH_TOKEN || '',
          cli_opusModel: parsed.env?.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
          cli_sonnetModel: parsed.env?.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
          cli_haikuModel: parsed.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
        });
      } catch {
        // Bỏ qua lỗi parse
      }

      setCliLoading(false);
      setLoading(false);
    }).catch(() => {
      message.error('Không thể tải cấu hình');
      setLoading(false);
      setCliLoading(false);
    });
  }, [form]);

  /** Lưu cả config web lẫn CLI settings */
  const handleSave = async (values: Record<string, any>) => {
    try {
      setSaving(true);

      // Tách giá trị web config vs CLI config
      const webConfig: GlobalConfig = {
        model: values.model,
        maxBudgetUsd: values.maxBudgetUsd,
        permissionMode: values.permissionMode,
        systemPrompt: values.systemPrompt,
        theme: values.theme,
      };

      // Cập nhật config web
      await configApi.update(webConfig);

      // Merge CLI settings — giữ nguyên các trường không sửa trên form
      const updatedCli = { ...cliSettings };
      if (values.cli_language !== undefined) updatedCli.language = values.cli_language || undefined;
      if (values.cli_effortLevel !== undefined) updatedCli.effortLevel = values.cli_effortLevel;

      // Merge env
      if (!updatedCli.env) updatedCli.env = {};
      if (values.cli_baseUrl !== undefined) updatedCli.env.ANTHROPIC_BASE_URL = values.cli_baseUrl || undefined;
      if (values.cli_authToken !== undefined) updatedCli.env.ANTHROPIC_AUTH_TOKEN = values.cli_authToken || undefined;
      if (values.cli_opusModel !== undefined) updatedCli.env.ANTHROPIC_DEFAULT_OPUS_MODEL = values.cli_opusModel || undefined;
      if (values.cli_sonnetModel !== undefined) updatedCli.env.ANTHROPIC_DEFAULT_SONNET_MODEL = values.cli_sonnetModel || undefined;
      if (values.cli_haikuModel !== undefined) updatedCli.env.ANTHROPIC_DEFAULT_HAIKU_MODEL = values.cli_haikuModel || undefined;

      // Xóa các giá trị undefined trong env
      for (const key of Object.keys(updatedCli.env)) {
        if (updatedCli.env[key] === undefined || updatedCli.env[key] === '') {
          delete updatedCli.env[key];
        }
      }
      // Xóa trường language nếu rỗng
      if (!updatedCli.language) delete updatedCli.language;

      await claudeApi.updateRawSettings(JSON.stringify(updatedCli));
      setCliSettings(updatedCli);

      message.success('Đã lưu cấu hình');
    } catch {
      message.error('Lỗi khi lưu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Spin spinning={loading || cliLoading}>
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSave}
        initialValues={{
          model: 'sonnet',
          permissionMode: 'default',
          theme: 'dark',
          cli_effortLevel: 'high',
        }}
      >
        {/* ---- Nhóm: Model & API ---- */}
        <Title level={5} style={{ color: '#b8b0ff' }}>
          <ThunderboltOutlined style={{ marginRight: 4 }} />
          Model & API
        </Title>

        <Form.Item name="model" label="Model mặc định (Web)">
          <Select
            options={[
              { value: 'sonnet', label: 'Claude Sonnet (Nhanh & Thông minh)' },
              { value: 'opus', label: 'Claude Opus (Mạnh nhất)' },
              { value: 'haiku', label: 'Claude Haiku (Nhanh & Rẻ)' },
            ]}
          />
        </Form.Item>

        <Form.Item name="permissionMode" label="Chế độ quyền">
          <Select
            options={[
              { value: 'default', label: 'Mặc định (Hỏi xác nhận)' },
              { value: 'acceptEdits', label: 'Tự động chấp nhận chỉnh sửa' },
              { value: 'plan', label: 'Chỉ lên kế hoạch' },
              { value: 'bypassPermissions', label: 'Bỏ qua tất cả (Cẩn thận!)' },
            ]}
          />
        </Form.Item>

        <Form.Item name="maxBudgetUsd" label="Giới hạn chi phí (USD)">
          <InputNumber
            min={0}
            step={0.5}
            placeholder="e.g. 5.00"
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Divider style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        {/* ---- Nhóm: Claude CLI – API & Env ---- */}
        <Title level={5} style={{ color: '#b8b0ff' }}>
          <ApiOutlined style={{ marginRight: 4 }} />
          API & Kết nối (Claude CLI)
        </Title>

        <Form.Item
          name="cli_baseUrl"
          label={
            <Space>
              Base URL
              <Tooltip title="Biến ANTHROPIC_BASE_URL — dùng khi kết nối qua proxy hoặc endpoint tùy chỉnh">
                <InfoCircleOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />
              </Tooltip>
            </Space>
          }
        >
          <Input placeholder="https://api.anthropic.com/v1" />
        </Form.Item>

        <Form.Item
          name="cli_authToken"
          label={
            <Space>
              Auth Token
              <Tooltip title="Biến ANTHROPIC_AUTH_TOKEN — API key để xác thực">
                <InfoCircleOutlined style={{ color: 'rgba(255,255,255,0.3)' }} />
              </Tooltip>
            </Space>
          }
        >
          <Input.Password placeholder="sk-..." />
        </Form.Item>

        <Divider style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        {/* ---- Nhóm: Model Aliases ---- */}
        <Title level={5} style={{ color: '#b8b0ff' }}>
          <ExperimentOutlined style={{ marginRight: 4 }} />
          Model Aliases (Claude CLI)
        </Title>

        <Form.Item
          name="cli_sonnetModel"
          label="Sonnet Model ID"
        >
          <Input placeholder="claude-sonnet-4-20250514 (hoặc alias tùy chỉnh)" />
        </Form.Item>

        <Form.Item
          name="cli_opusModel"
          label="Opus Model ID"
        >
          <Input placeholder="claude-opus-4-20250514 (hoặc alias tùy chỉnh)" />
        </Form.Item>

        <Form.Item
          name="cli_haikuModel"
          label="Haiku Model ID"
        >
          <Input placeholder="claude-haiku-4-20250514 (hoặc alias tùy chỉnh)" />
        </Form.Item>

        <Divider style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        {/* ---- Nhóm: Ngôn ngữ & Mức độ ---- */}
        <Title level={5} style={{ color: '#b8b0ff' }}>
          <TranslationOutlined style={{ marginRight: 4 }} />
          Ngôn ngữ & Mức độ (Claude CLI)
        </Title>

        <Form.Item name="cli_language" label="Ngôn ngữ trả lời">
          <Input placeholder="Vietnamese, English, Japanese..." />
        </Form.Item>

        <Form.Item name="cli_effortLevel" label="Mức độ nỗ lực (Effort Level)">
          <Select
            options={[
              { value: 'low', label: 'Thấp (Low) — Phản hồi nhanh, ngắn gọn' },
              { value: 'medium', label: 'Trung bình (Medium) — Cân bằng' },
              { value: 'high', label: 'Cao (High) — Chi tiết, đầy đủ nhất' },
            ]}
          />
        </Form.Item>

        <Divider style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        {/* ---- Nhóm: Prompt ---- */}
        <Title level={5} style={{ color: '#b8b0ff' }}>Prompt & Tùy chỉnh</Title>

        <Form.Item name="systemPrompt" label="System Prompt bổ sung">
          <Input.TextArea
            rows={4}
            placeholder="Thêm prompt hệ thống (nối sau prompt mặc định)..."
          />
        </Form.Item>

        <Divider style={{ borderColor: 'rgba(255,255,255,0.06)' }} />

        <Form.Item>
          <Button
            type="primary"
            htmlType="submit"
            icon={<SaveOutlined />}
            loading={saving}
            className="primary-btn"
            size="large"
          >
            Lưu cấu hình
          </Button>
        </Form.Item>
      </Form>
    </Spin>
  );
};


// ============================
// Tab 2: Cấu hình Web nâng cao (JSON)
// ============================
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
    // Validate JSON realtime
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
        message="Cấu hình nội bộ của ứng dụng Web"
        description="Chỉnh sửa trực tiếp đối tượng GlobalConfig (model, permissionMode, customArgs, maxBudgetUsd,...). Trường customArgs cho phép truyền thêm flags dòng lệnh cho Claude CLI."
        type="info"
        showIcon
        style={{ marginBottom: 16, background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)' }}
      />

      {parseError && (
        <Alert
          message="Lỗi JSON"
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


// ============================
// Tab 3: Cấu hình Claude CLI gốc (JSON)
// ============================
const CliSettingsJsonTab: React.FC = () => {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  useEffect(() => {
    claudeApi.getRawSettings().then((raw) => {
      // Format lại cho đẹp khi hiển thị
      try {
        const parsed = JSON.parse(raw.content);
        setValue(JSON.stringify(parsed, null, 2));
      } catch {
        setValue(raw.content);
      }
      setLoading(false);
    }).catch(() => {
      message.error('Không thể tải cấu hình Claude CLI');
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
      JSON.parse(value); // Validate trước
      setSaving(true);
      await claudeApi.updateRawSettings(value);
      message.success('Đã lưu cấu hình Claude CLI');
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
        message="Cấu hình gốc ~/.claude/settings.json"
        description="File cấu hình toàn cục của Claude CLI. Bao gồm env, permissions, enabledPlugins, language, effortLevel,... Thay đổi sẽ ghi trực tiếp vào file hệ thống."
        type="warning"
        showIcon
        style={{ marginBottom: 16, background: 'rgba(253,203,110,0.08)', border: '1px solid rgba(253,203,110,0.2)' }}
      />

      {parseError && (
        <Alert
          message="Lỗi JSON"
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
        Lưu cấu hình Claude CLI
      </Button>
    </Spin>
  );
};


// ============================
// Tab 4: MCP Servers (JSON)
// ============================
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
        message="MCP Servers — ~/.claude.json"
        description="Cấu hình các Model Context Protocol servers. Mỗi server cần có command, args, và type (stdio/sse). Thay đổi sẽ ghi trực tiếp vào trường mcpServers trong file ~/.claude.json."
        type="info"
        showIcon
        style={{ marginBottom: 16, background: 'rgba(0,206,209,0.06)', border: '1px solid rgba(0,206,209,0.2)' }}
      />

      {parseError && (
        <Alert
          message="Lỗi JSON"
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


// ============================
// Tab 5: Agents — ~/.claude/agents/*.md
// ============================
const AgentsTab: React.FC = () => {
  const [agents, setAgents] = useState<{ name: string; filename: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  // Load danh sách agents
  const loadAgents = useCallback(async () => {
    try {
      const list = await claudeApi.listAgents();
      setAgents(list);
      if (list.length > 0 && !selected) {
        setSelected(list[0].filename);
      }
    } catch {
      message.error('Không thể tải danh sách agents');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  // Load nội dung agent khi chọn
  useEffect(() => {
    if (!selected) { setContent(''); return; }
    claudeApi.getAgent(selected).then(res => {
      setContent(res.content);
    }).catch(() => {
      message.error('Không thể đọc agent');
      setContent('');
    });
  }, [selected]);

  const handleSave = async () => {
    if (!selected) return;
    try {
      setSaving(true);
      await claudeApi.updateAgent(selected, content);
      message.success('Đã lưu agent');
    } catch {
      message.error('Lỗi khi lưu');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await claudeApi.createAgent(name);
      setNewName('');
      await loadAgents();
      setSelected(res.filename);
      message.success(`Đã tạo agent: ${res.filename}`);
    } catch (e: any) {
      message.error(e.message || 'Lỗi khi tạo agent');
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await claudeApi.deleteAgent(selected);
      setSelected(null);
      setContent('');
      await loadAgents();
      message.success('Đã xóa agent');
    } catch {
      message.error('Lỗi khi xóa');
    }
  };

  return (
    <Spin spinning={loading}>
      <Alert
        message="Agents — ~/.claude/agents/"
        description="Khai báo các agent dưới dạng file .md với YAML frontmatter. Chọn file để chỉnh sửa hoặc tạo mới."
        type="info"
        showIcon
        style={{ marginBottom: 16, background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)' }}
      />

      {/* Tạo agent mới */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Input
          placeholder="Tên agent mới..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onPressEnter={handleCreate}
          style={{ flex: 1 }}
        />
        <Button icon={<PlusOutlined />} onClick={handleCreate} disabled={!newName.trim()}>
          Tạo
        </Button>
      </div>

      {/* Chọn agent */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Select
          placeholder="Chọn agent..."
          value={selected}
          onChange={setSelected}
          style={{ flex: 1 }}
          options={agents.map(a => ({ value: a.filename, label: a.name }))}
          notFoundContent="Chưa có agent nào"
        />
        {selected && (
          <Button icon={<DeleteOutlined />} danger onClick={handleDelete}>
            Xóa
          </Button>
        )}
      </div>

      {/* Editor */}
      {selected && (
        <>
          <div style={{
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8,
            overflow: 'hidden',
            marginBottom: 16,
          }}>
            <Editor
              height="450px"
              language="markdown"
              theme="vs-dark"
              value={content}
              onChange={v => setContent(v || '')}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                lineNumbers: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false,
                padding: { top: 12, bottom: 12 },
                wordWrap: 'on',
                tabSize: 2,
              }}
            />
          </div>

          <Button
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            onClick={handleSave}
            className="primary-btn"
            size="large"
          >
            Lưu agent
          </Button>
        </>
      )}
    </Spin>
  );
};


// ============================
// Trang Settings chính — Tabs container
// ============================
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
