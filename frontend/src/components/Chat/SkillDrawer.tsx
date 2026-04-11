import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  Tabs,
  Empty,
  Button,
  Input,
  Tooltip,
  Popconfirm,
  message,
} from 'antd';
import {
  ThunderboltOutlined,
  GlobalOutlined,
  FolderOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  SaveOutlined,
  CloseOutlined,
  ArrowLeftOutlined,
} from '@ant-design/icons';
import { claudeApi } from '../../services/api';

/** Thông tin 1 custom command */
interface CommandInfo {
  filename: string;
  name: string;
  desc: string;
}

interface SkillDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
}

/**
 * Drawer quản lý Custom Slash Commands (Skills).
 * 2 tab: Global (~/.claude/commands/) và Project (<path>/.claude/commands/).
 * Hỗ trợ xem danh sách, thêm mới, sửa nội dung, xóa.
 */
const SkillDrawer: React.FC<SkillDrawerProps> = ({ open, onClose, projectId }) => {
  // Danh sách commands theo scope
  const [globalCmds, setGlobalCmds] = useState<CommandInfo[]>([]);
  const [projectCmds, setProjectCmds] = useState<CommandInfo[]>([]);
  const [loading, setLoading] = useState(false);

  // Editor state — null = không editor, có giá trị = đang sửa
  const [editingScope, setEditingScope] = useState<'global' | 'project' | null>(null);
  const [editingFilename, setEditingFilename] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [newName, setNewName] = useState('');

  /** Full-width drawer trên mobile */
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /** Load danh sách commands cả 2 scope */
  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      claudeApi.listCustomCommands('global'),
      projectId ? claudeApi.listCustomCommands('project', projectId) : Promise.resolve([]),
    ])
      .then(([global, project]) => {
        setGlobalCmds(global);
        setProjectCmds(project);
      })
      .catch(() => {
        setGlobalCmds([]);
        setProjectCmds([]);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  // Load khi mở drawer
  useEffect(() => {
    if (open) {
      loadData();
      // Reset editor khi mở lại
      setEditingScope(null);
      setEditingFilename(null);
      setIsNew(false);
    }
  }, [open, loadData]);

  /** Mở editor để sửa command đã có */
  const handleEdit = useCallback(async (scope: 'global' | 'project', filename: string) => {
    try {
      const { content } = await claudeApi.getCustomCommand(filename, scope, projectId);
      setEditingScope(scope);
      setEditingFilename(filename);
      setEditContent(content);
      setIsNew(false);
    } catch (err: any) {
      message.error(err.message || 'Không thể đọc command');
    }
  }, [projectId]);

  /** Mở editor để tạo command mới */
  const handleNew = useCallback((scope: 'global' | 'project') => {
    setEditingScope(scope);
    setEditingFilename(null);
    setEditContent(`---
description: Mô tả ngắn về skill này
---

# Hướng dẫn cho Claude

Viết nội dung prompt tại đây. Claude sẽ nhận được toàn bộ nội dung này khi user gõ lệnh.
`);
    setIsNew(true);
    setNewName('');
  }, []);

  /** Lưu command (tạo hoặc cập nhật) */
  const handleSave = useCallback(async () => {
    if (!editingScope) return;

    const filename = isNew ? newName.trim() : editingFilename;
    if (!filename) {
      message.error('Tên command không được để trống');
      return;
    }

    // Validate tên: chỉ cho phép a-z, 0-9, dấu gạch ngang
    if (isNew && !/^[a-z0-9][a-z0-9-]*$/.test(filename)) {
      message.error('Tên chỉ được chứa chữ thường, số, dấu gạch ngang');
      return;
    }

    setSaving(true);
    try {
      const safeName = filename.endsWith('.md') ? filename : `${filename}.md`;
      await claudeApi.saveCustomCommand(safeName, editContent, editingScope, projectId);
      message.success(isNew ? 'Đã tạo command mới' : 'Đã lưu thay đổi');
      setEditingScope(null);
      setEditingFilename(null);
      setIsNew(false);
      loadData();
    } catch (err: any) {
      message.error(err.message || 'Lỗi khi lưu');
    } finally {
      setSaving(false);
    }
  }, [editingScope, editingFilename, editContent, isNew, newName, projectId, loadData]);

  /** Xóa command */
  const handleDelete = useCallback(async (scope: 'global' | 'project', filename: string) => {
    try {
      await claudeApi.deleteCustomCommand(filename, scope, projectId);
      message.success('Đã xóa command');
      loadData();
    } catch (err: any) {
      message.error(err.message || 'Lỗi khi xóa');
    }
  }, [projectId, loadData]);

  /** Quay lại danh sách từ editor */
  const handleBack = () => {
    setEditingScope(null);
    setEditingFilename(null);
    setIsNew(false);
  };

  /** Render danh sách command cards */
  const renderCommandList = (commands: CommandInfo[], scope: 'global' | 'project') => {
    if (commands.length === 0) {
      return (
        <Empty
          description={
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Chưa có custom command nào
            </span>
          }
          imageStyle={{ height: 40 }}
          style={{ margin: '16px 0' }}
        />
      );
    }

    return commands.map((cmd) => (
      <div key={cmd.filename} className="skill-card">
        <div className="skill-card-header">
          <ThunderboltOutlined style={{ color: 'var(--accent)', fontSize: 13 }} />
          <span className="skill-card-name">/{cmd.name}</span>
          <div className="skill-card-actions">
            <Tooltip title="Sửa">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={() => handleEdit(scope, cmd.filename)}
                className="skill-action-btn"
              />
            </Tooltip>
            <Popconfirm
              title="Xóa command này?"
              description={`/${cmd.name} sẽ bị xóa vĩnh viễn`}
              onConfirm={() => handleDelete(scope, cmd.filename)}
              okText="Xóa"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="Xóa">
                <Button
                  type="text"
                  size="small"
                  icon={<DeleteOutlined />}
                  className="skill-action-btn skill-action-btn-danger"
                />
              </Tooltip>
            </Popconfirm>
          </div>
        </div>
        {cmd.desc && (
          <div className="skill-card-desc">{cmd.desc}</div>
        )}
      </div>
    ));
  };

  /** Render editor view */
  const renderEditor = () => (
    <div className="skill-editor">
      <div className="skill-editor-header">
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={handleBack}
          size="small"
          style={{ color: 'var(--text-secondary)' }}
        />
        <span className="skill-editor-title">
          {isNew ? 'Tạo command mới' : `Sửa /${editingFilename?.replace('.md', '')}`}
        </span>
        <span className="skill-editor-scope">
          {editingScope === 'global' ? 'Global' : 'Project'}
        </span>
      </div>

      {isNew && (
        <div style={{ padding: '0 0 12px' }}>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="tên-command (vd: review-code)"
            addonBefore="/"
            size="small"
            className="skill-name-input"
            spellCheck={false}
          />
        </div>
      )}

      <Input.TextArea
        value={editContent}
        onChange={(e) => setEditContent(e.target.value)}
        autoSize={{ minRows: 12, maxRows: 25 }}
        className="skill-editor-textarea"
        spellCheck={false}
        placeholder="Nội dung markdown cho command..."
      />

      <div className="skill-editor-actions">
        <Button
          size="small"
          icon={<CloseOutlined />}
          onClick={handleBack}
        >
          Hủy
        </Button>
        <Button
          type="primary"
          size="small"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={isNew && !newName.trim()}
        >
          Lưu
        </Button>
      </div>
    </div>
  );

  /** Tab Global */
  const globalTab = (
    <div>
      <div className="skill-tab-header">
        <div className="skill-tab-info">
          <GlobalOutlined style={{ color: '#00cec9' }} />
          <span>Áp dụng cho tất cả dự án</span>
        </div>
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => handleNew('global')}
          className="skill-add-btn"
        >
          Thêm
        </Button>
      </div>
      {renderCommandList(globalCmds, 'global')}
    </div>
  );

  /** Tab Project */
  const projectTab = (
    <div>
      <div className="skill-tab-header">
        <div className="skill-tab-info">
          <FolderOutlined style={{ color: 'var(--accent)' }} />
          <span>Riêng cho dự án hiện tại</span>
        </div>
        <Button
          type="text"
          size="small"
          icon={<PlusOutlined />}
          onClick={() => handleNew('project')}
          className="skill-add-btn"
          disabled={!projectId}
        >
          Thêm
        </Button>
      </div>
      {projectId
        ? renderCommandList(projectCmds, 'project')
        : (
          <Empty
            description={
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                Chọn dự án trước để quản lý skills
              </span>
            }
            imageStyle={{ height: 40 }}
            style={{ margin: '16px 0' }}
          />
        )
      }
    </div>
  );

  const tabItems = [
    {
      key: 'global',
      label: (
        <span style={{ fontSize: 12 }}>
          <GlobalOutlined style={{ marginRight: 4 }} />
          Global ({globalCmds.length})
        </span>
      ),
      children: globalTab,
    },
    {
      key: 'project',
      label: (
        <span style={{ fontSize: 12 }}>
          <FolderOutlined style={{ marginRight: 4 }} />
          Project ({projectCmds.length})
        </span>
      ),
      children: projectTab,
    },
  ];

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ThunderboltOutlined style={{ color: 'var(--accent)', fontSize: 16 }} />
          <span>Skills</span>
          <span style={{
            background: 'rgba(108, 92, 231, 0.2)',
            color: 'var(--accent)',
            fontSize: 11,
            padding: '1px 8px',
            borderRadius: 10,
            fontWeight: 600,
          }}>
            {globalCmds.length + projectCmds.length}
          </span>
        </div>
      }
      placement="right"
      open={open}
      onClose={onClose}
      className="mcp-drawer"
      styles={{
        wrapper: { width: isMobile ? '100%' : 420 },
        header: {
          background: 'rgba(22, 22, 38, 0.98)',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
        },
        body: {
          background: 'rgba(22, 22, 38, 0.98)',
          padding: '0 16px 16px',
        },
      }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          Đang tải...
        </div>
      ) : editingScope ? (
        renderEditor()
      ) : (
        <Tabs
          items={tabItems}
          defaultActiveKey="global"
          size="small"
          className="mcp-tabs"
        />
      )}
    </Drawer>
  );
};

export default SkillDrawer;
