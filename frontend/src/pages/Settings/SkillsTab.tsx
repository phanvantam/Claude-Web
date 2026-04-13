import React, { useEffect, useState, useCallback } from 'react';
import { Alert, Button, Input, Select, Spin, message } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { claudeApi } from '../../services/api';

const SkillsTab: React.FC = () => {
  const [skills, setSkills] = useState<{ filename: string; name: string; desc: string }[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newName, setNewName] = useState('');

  const loadSkills = useCallback(async () => {
    try {
      setLoading(true);
      const list = await claudeApi.listCustomCommands('global');
      setSkills(list);
      if (list.length > 0 && !selected) {
        setSelected(list[0].filename);
      }
    } catch {
      message.error('Không thể tải danh sách skills');
    } finally {
      setLoading(false);
    }
  }, [selected]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  useEffect(() => {
    if (!selected) { setContent(''); return; }
    claudeApi.getCustomCommand(selected, 'global').then(res => {
      setContent(res.content);
    }).catch(() => {
      message.error('Không thể đọc nội dung skill');
      setContent('');
    });
  }, [selected]);

  const handleSave = async () => {
    if (!selected) return;
    try {
      setSaving(true);
      await claudeApi.saveCustomCommand(selected, content, 'global');
      message.success('Đã lưu skill');
      await loadSkills();
    } catch {
      message.error('Lỗi khi lưu skill');
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const filename = name.toLowerCase().replace(/\s+/g, '-') + '.md';
    try {
      const defaultContent = `---\ndescription: Mô tả cho lệnh /${name.replace('.md', '')}\n---\n\nNội dung thực thi của lệnh ở đây.`;
      await claudeApi.saveCustomCommand(filename, defaultContent, 'global');
      setNewName('');
      await loadSkills();
      setSelected(filename);
      message.success(`Đã tạo skill mới: ${filename}`);
    } catch (e: any) {
      message.error(e.message || 'Lỗi khi tạo skill');
    }
  };

  const handleDelete = async () => {
    if (!selected) return;
    try {
      await claudeApi.deleteCustomCommand(selected, 'global');
      setSelected(null);
      setContent('');
      await loadSkills();
      message.success('Đã xóa skill');
    } catch {
      message.error('Lỗi khi xóa skill');
    }
  };

  return (
    <Spin spinning={loading}>
      <Alert
        message="Custom Skills — ~/.claude/skills/"
        description="Định nghĩa các slash command tùy chỉnh để mở rộng khả năng của Claude toàn cục."
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
      />
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <Input
          placeholder="Tên lệnh mới..."
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onPressEnter={handleCreate}
        />
        <Button icon={<PlusOutlined />} onClick={handleCreate} disabled={!newName.trim()}>
          Tạo mới
        </Button>
      </div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <Select
          style={{ flex: 1 }}
          placeholder="Chọn skill..."
          value={selected}
          onChange={setSelected}
          options={skills.map(s => ({ value: s.filename, label: `/${s.name} - ${s.desc || s.filename}` }))}
        />
        {selected && (
          <Button icon={<DeleteOutlined />} danger onClick={handleDelete} />
        )}
      </div>
      {selected && (
        <>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
            <Editor
              height="400px"
              language="markdown"
              theme="vs-dark"
              value={content}
              onChange={v => setContent(v || '')}
              options={{ minimap: { enabled: false }, fontSize: 13 }}
            />
          </div>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave} className="primary-btn">
            Lưu thay đổi
          </Button>
        </>
      )}
    </Spin>
  );
};

export default SkillsTab;
