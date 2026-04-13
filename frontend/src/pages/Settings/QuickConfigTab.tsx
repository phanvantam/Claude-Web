import React, { useEffect, useState } from 'react';
import {
  Form,
  Input,
  Select,
  InputNumber,
  Button,
  Typography,
  message,
  Divider,
  Space,
  Spin,
  Tooltip,
} from 'antd';
import {
  SaveOutlined,
  ThunderboltOutlined,
  ApiOutlined,
  TranslationOutlined,
  ExperimentOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { configApi, claudeApi } from '../../services/api';
import type { GlobalConfig } from '../../types';

const { Title } = Typography;

const QuickConfigTab: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Cấu hình Claude CLI gốc (language, effortLevel, env)
  const [cliSettings, setCliSettings] = useState<Record<string, any>>({});
  const [cliLoading, setCliLoading] = useState(true);
  const [modelOptions, setModelOptions] = useState<import('../../services/api').ModelInfo[]>([]);

  useEffect(() => {
    // Tải song song: config web + settings CLI
    Promise.all([
      configApi.get(),
      claudeApi.getRawSettings(),
      claudeApi.getModels(),
    ]).then(([webConfig, raw, modelData]) => {
      form.setFieldsValue(webConfig);
      setModelOptions(modelData.models);

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
            options={modelOptions.map(m => ({ value: m.key, label: m.label }))}
            placeholder="Chọn model mặc định..."
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

export default QuickConfigTab;
