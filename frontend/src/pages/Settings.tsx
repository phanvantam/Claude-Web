import React, { useEffect, useState } from 'react';
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
} from 'antd';
import {
  SettingOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { configApi } from '../services/api';
import type { GlobalConfig } from '../types';

const { Title, Text } = Typography;

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    configApi.get().then((config) => {
      form.setFieldsValue(config);
      setLoading(false);
    }).catch(() => {
      message.error('Không thể tải cấu hình');
      setLoading(false);
    });
  }, [form]);

  const handleSave = async (values: GlobalConfig) => {
    try {
      setSaving(true);
      await configApi.update(values);
      message.success('Đã lưu cấu hình');
    } catch {
      message.error('Lỗi khi lưu');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <Title level={3} style={{ color: '#fff', margin: 0 }}>
            <SettingOutlined style={{ marginRight: 8, color: '#6c5ce7' }} />
            Cấu hình chung
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.4)' }}>
            Thiết lập cấu hình mặc định cho Claude CLI
          </Text>
        </div>
      </div>

      <Card className="glass-card" loading={loading}>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSave}
          initialValues={{
            model: 'sonnet',
            permissionMode: 'default',
            theme: 'dark',
          }}
        >
          <Title level={5} style={{ color: '#b8b0ff' }}>
            <ThunderboltOutlined style={{ marginRight: 4 }} />
            Model & API
          </Title>

          <Form.Item name="model" label="Model mặc định">
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
      </Card>
    </div>
  );
};

export default Settings;
