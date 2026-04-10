import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  Badge,
  Spin,
  Tag,
  Tooltip,
  Empty,
  Tabs,
  Button,
  Input,
  message,
} from 'antd';
import {
  CloudServerOutlined,
  CheckCircleFilled,
  InfoCircleFilled,
  EditOutlined,
  SaveOutlined,
  CloseOutlined,
  GlobalOutlined,
  FolderOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { claudeApi } from '../../services/api';

/** Thông tin 1 MCP server được parse từ config */
interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  type: string;
  envKeys: string[];
}

/** Parse object MCP servers thành danh sách hiển thị */
function parseServers(raw: Record<string, any>): McpServerInfo[] {
  return Object.entries(raw).map(([name, cfg]: [string, any]) => ({
    name,
    command: cfg.command || '—',
    args: cfg.args || [],
    type: cfg.type || 'stdio',
    envKeys: cfg.env ? Object.keys(cfg.env) : [],
  }));
}

/**
 * Nút MCP trên chat header — bấm mở Drawer quản lý MCP servers.
 *
 * Hiển thị 2 tab:
 * - Global: MCP servers dùng chung cho tất cả dự án (root mcpServers trong ~/.claude.json)
 * - Project: MCP servers riêng cho dự án hiện tại (projects[path].mcpServers)
 *
 * Mỗi tab cho phép xem danh sách và chỉnh sửa JSON trực tiếp.
 */
interface McpStatusPopoverProps {
  projectId?: string;
}

const McpStatusPopover: React.FC<McpStatusPopoverProps> = ({ projectId }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);

  // Dữ liệu MCP tách biệt global / project
  const [globalServers, setGlobalServers] = useState<McpServerInfo[]>([]);
  const [projectServers, setProjectServers] = useState<McpServerInfo[]>([]);
  const [globalRaw, setGlobalRaw] = useState<Record<string, any>>({});
  const [projectRaw, setProjectRaw] = useState<Record<string, any>>({});
  const [projectPath, setProjectPath] = useState<string | null>(null);

  // Editing state
  const [editingGlobal, setEditingGlobal] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [globalEditValue, setGlobalEditValue] = useState('');
  const [projectEditValue, setProjectEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  /** Tải dữ liệu MCP từ backend */
  const loadData = useCallback(() => {
    setLoading(true);
    claudeApi
      .getMcpServersDetailed(projectId)
      .then((result) => {
        setGlobalRaw(result.global);
        setProjectRaw(result.project);
        setGlobalServers(parseServers(result.global));
        setProjectServers(parseServers(result.project));
        setProjectPath(result.projectPath);
        setTotalCount(
          Object.keys(result.global).length + Object.keys(result.project).length
        );
      })
      .catch(() => {
        setGlobalServers([]);
        setProjectServers([]);
        setTotalCount(0);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  // Load khi mở drawer
  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  // Load count ban đầu — không cần mở drawer
  useEffect(() => {
    claudeApi
      .getMcpServersDetailed(projectId)
      .then((result) => {
        setTotalCount(
          Object.keys(result.global).length + Object.keys(result.project).length
        );
      })
      .catch(() => {});
  }, [projectId]);

  /** Lưu global MCP */
  const handleSaveGlobal = async () => {
    setSaving(true);
    try {
      JSON.parse(globalEditValue); // Validate trước
      await claudeApi.updateMcpServers(globalEditValue);
      message.success('Đã lưu MCP servers (Global)');
      setEditingGlobal(false);
      loadData();
    } catch (err: any) {
      message.error(err.message || 'JSON không hợp lệ');
    } finally {
      setSaving(false);
    }
  };

  /** Lưu project MCP */
  const handleSaveProject = async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      JSON.parse(projectEditValue); // Validate trước
      await claudeApi.updateProjectMcpServers(projectId, projectEditValue);
      message.success('Đã lưu MCP servers (Project)');
      setEditingProject(false);
      loadData();
    } catch (err: any) {
      message.error(err.message || 'JSON không hợp lệ');
    } finally {
      setSaving(false);
    }
  };

  /** Render danh sách servers (dùng chung cho cả 2 tab) */
  const renderServerList = (servers: McpServerInfo[]) => {
    if (servers.length === 0) {
      return (
        <Empty
          description={
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              Chưa cấu hình MCP server nào
            </span>
          }
          imageStyle={{ height: 40 }}
          style={{ margin: '16px 0' }}
        />
      );
    }

    return servers.map((srv) => (
      <div key={srv.name} className="mcp-server-card">
        {/* Tên server + type tag */}
        <div className="mcp-server-header">
          <CheckCircleFilled style={{ color: '#00b894', fontSize: 12 }} />
          <span className="mcp-server-name">{srv.name}</span>
          <Tag className="mcp-server-type-tag">{srv.type}</Tag>
        </div>

        {/* Command */}
        <div className="mcp-server-cmd">
          <Tooltip title={`${srv.command} ${srv.args.join(' ')}`}>
            <span>
              {srv.command} {srv.args.slice(0, 2).join(' ')}
              {srv.args.length > 2 ? ' ...' : ''}
            </span>
          </Tooltip>
        </div>

        {/* Env keys */}
        {srv.envKeys.length > 0 && (
          <div className="mcp-server-env">
            {srv.envKeys.slice(0, 3).map((key) => (
              <Tag key={key} className="mcp-env-tag">
                {key}
              </Tag>
            ))}
            {srv.envKeys.length > 3 && (
              <Tag className="mcp-env-tag">+{srv.envKeys.length - 3}</Tag>
            )}
          </div>
        )}
      </div>
    ));
  };

  /** Render phần edit JSON */
  const renderEditor = (
    value: string,
    onChange: (v: string) => void,
    onSave: () => void,
    onCancel: () => void
  ) => (
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

  /** Tab Global */
  const globalTab = (
    <div>
      <div className="mcp-tab-header">
        <div className="mcp-tab-info">
          <GlobalOutlined style={{ color: '#00cec9' }} />
          <span>Áp dụng cho tất cả dự án</span>
        </div>
        <button
          className={`mcp-edit-btn${editingGlobal ? ' active' : ''}`}
          onClick={() => {
            if (!editingGlobal) {
              setGlobalEditValue(JSON.stringify(globalRaw, null, 2));
            }
            setEditingGlobal(!editingGlobal);
          }}
        >
          {editingGlobal
            ? <><CloseOutlined /> Hủy</>
            : <><EditOutlined /> Sửa</>}
        </button>
      </div>

      {editingGlobal
        ? renderEditor(
            globalEditValue,
            setGlobalEditValue,
            handleSaveGlobal,
            () => setEditingGlobal(false)
          )
        : renderServerList(globalServers)}
    </div>
  );

  /** Tab Project */
  const projectTab = (
    <div>
      <div className="mcp-tab-header">
        <div className="mcp-tab-info">
          <FolderOutlined style={{ color: '#6c5ce7' }} />
          <Tooltip title={projectPath || '—'}>
            <span style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {projectPath ? projectPath.split('/').slice(-2).join('/') : 'Chưa chọn dự án'}
            </span>
          </Tooltip>
        </div>
        <button
          className={`mcp-edit-btn${editingProject ? ' active' : ''}`}
          onClick={() => {
            if (!editingProject) {
              setProjectEditValue(JSON.stringify(projectRaw, null, 2));
            }
            setEditingProject(!editingProject);
          }}
          disabled={!projectId}
        >
          {editingProject
            ? <><CloseOutlined /> Hủy</>
            : projectServers.length === 0
              ? <><PlusOutlined /> Thêm</>
              : <><EditOutlined /> Sửa</>}
        </button>
      </div>

      {editingProject
        ? renderEditor(
            projectEditValue,
            setProjectEditValue,
            handleSaveProject,
            () => setEditingProject(false)
          )
        : renderServerList(projectServers)}
    </div>
  );

  const tabItems = [
    {
      key: 'global',
      label: (
        <span style={{ fontSize: 12 }}>
          <GlobalOutlined style={{ marginRight: 4 }} />
          Global ({globalServers.length})
        </span>
      ),
      children: globalTab,
    },
    {
      key: 'project',
      label: (
        <span style={{ fontSize: 12 }}>
          <FolderOutlined style={{ marginRight: 4 }} />
          Project ({projectServers.length})
        </span>
      ),
      children: projectTab,
    },
  ];

  return (
    <>
      <Tooltip title="MCP Servers">
        <Badge
          count={totalCount}
          size="small"
          style={{
            backgroundColor: totalCount > 0 ? '#00b894' : 'rgba(255,255,255,0.15)',
            fontSize: 9,
            minWidth: 14,
            height: 14,
            lineHeight: '14px',
          }}
          offset={[-2, 4]}
        >
          <CloudServerOutlined
            onClick={() => setOpen(true)}
            style={{
              fontSize: 15,
              color: 'rgba(255,255,255,0.4)',
              cursor: 'pointer',
              padding: 4,
              transition: 'color 0.2s',
            }}
          />
        </Badge>
      </Tooltip>

      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <CloudServerOutlined style={{ color: '#00cec9' }} />
            <span>MCP Servers</span>
            <Tag
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                background: 'rgba(0,206,201,0.1)',
                border: '1px solid rgba(0,206,201,0.25)',
                color: '#00cec9',
              }}
            >
              {totalCount} server{totalCount !== 1 ? 's' : ''}
            </Tag>
          </div>
        }
        placement="right"
        open={open}
        onClose={() => {
          setOpen(false);
          setEditingGlobal(false);
          setEditingProject(false);
        }}
        width={420}
        className="mcp-drawer"
        styles={{
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
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <Spin size="default" />
          </div>
        ) : (
          <>
            <Tabs
              items={tabItems}
              defaultActiveKey="global"
              size="small"
              className="mcp-tabs"
            />

            {/* Footer note */}
            <div className="mcp-footer-note">
              <InfoCircleFilled style={{ fontSize: 11, marginTop: 2, flexShrink: 0 }} />
              <span>
                <b>Mẹo:</b> Nên cài đặt global các gói (npm -g) và gọi lệnh trực tiếp thay vì <b>npx</b> để khởi động MCP tức thì.
                Cần gửi tin nhắn mới để áp dụng thay đổi.
              </span>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
};

export default McpStatusPopover;
