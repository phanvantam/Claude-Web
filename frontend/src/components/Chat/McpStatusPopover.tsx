import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer,
  Badge,
  Spin,
  Tag,
  Tooltip,
  Tabs,
  Button,
  message,
} from 'antd';
import {
  CloudServerOutlined,
  InfoCircleFilled,
  LoadingOutlined,
  ReloadOutlined,
  EditOutlined,
  CloseOutlined,
  GlobalOutlined,
  FolderOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { claudeApi } from '../../services/api';
import McpServerList, { parseServers } from './McpServerList';
import McpJsonEditor from './McpJsonEditor';
import type { McpServerInfo } from './McpServerList';
import type { McpRuntimeServer } from '../../hooks/useChat';



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
  /** Runtime status từ SDK init event — trạng thái kết nối thực tế */
  runtimeStatus?: McpRuntimeServer[];
  /** Callback làm mới MCP — gửi lại config cho session đang chạy */
  onRefreshMcp?: () => void;
}

const McpStatusPopover: React.FC<McpStatusPopoverProps> = ({ projectId, runtimeStatus = [], onRefreshMcp }) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
        ? <McpJsonEditor
            value={globalEditValue}
            onChange={setGlobalEditValue}
            onSave={handleSaveGlobal}
            onCancel={() => setEditingGlobal(false)}
            saving={saving}
          />
        : <McpServerList servers={globalServers} runtimeStatus={runtimeStatus} />}
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
        ? <McpJsonEditor
            value={projectEditValue}
            onChange={setProjectEditValue}
            onSave={handleSaveProject}
            onCancel={() => setEditingProject(false)}
            saving={saving}
          />
        : <McpServerList servers={projectServers} runtimeStatus={runtimeStatus} />}
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
            backgroundColor: runtimeStatus.some(s => s.status === 'failed')
              ? '#ff6b6b'
              : totalCount > 0 ? '#00b894' : 'rgba(255,255,255,0.15)',
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
        extra={
          <Tooltip title="Làm mới MCP (gửi lại config cho session)">
            <Button
              type="text"
              size="small"
              icon={refreshing ? <LoadingOutlined spin /> : <ReloadOutlined />}
              disabled={refreshing}
              onClick={() => {
                if (!onRefreshMcp) return;
                setRefreshing(true);
                onRefreshMcp();
                // Reset sau 3s — chờ SDK init xong
                setTimeout(() => setRefreshing(false), 3000);
              }}
              style={{ color: 'rgba(255,255,255,0.5)' }}
            />
          </Tooltip>
        }
        placement="right"
        open={open}
        onClose={() => {
          setOpen(false);
          setEditingGlobal(false);
          setEditingProject(false);
        }}
        className="mcp-drawer"
        styles={{
          wrapper: { width: 420 },
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
                <b>Mẹo:</b> MCP chỉ được truyền khi tạo session mới. Dùng nút <b>Làm mới</b> để cập nhật config cho session đang chạy.
              </span>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
};

export default McpStatusPopover;
