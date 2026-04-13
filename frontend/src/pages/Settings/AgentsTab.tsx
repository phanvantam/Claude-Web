import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Button, Input, Select, Spin, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { claudeApi } from '../../services/api';

const AgentsTab: React.FC = () => {
  const [agents, setAgents] = useState<{ name: string; filename: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

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
        title="Agents — ~/.claude/agents/"
        description="Khai báo các agent dưới dạng file .md với YAML frontmatter. Chọn file để chỉnh sửa hoặc tạo mới."
        type="info"
        showIcon
        style={{ marginBottom: 16, background: 'rgba(108,92,231,0.08)', border: '1px solid rgba(108,92,231,0.2)' }}
      />

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

export default AgentsTab;
