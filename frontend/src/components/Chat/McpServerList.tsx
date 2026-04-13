/**
 * Card hiển thị danh sách MCP servers — dùng trong cả tab Global và Project.
 *
 * Tách từ McpStatusPopover.tsx — cô lập logic render server list.
 */

import React from 'react';
import { Tag, Tooltip, Empty } from 'antd';
import {
  CheckCircleFilled,
  InfoCircleFilled,
  LoadingOutlined,
} from '@ant-design/icons';
import type { McpRuntimeServer } from '../../hooks/useChat';

/** Thông tin 1 MCP server được parse từ config */
export interface McpServerInfo {
  name: string;
  command: string;
  args: string[];
  type: string;
  envKeys: string[];
}

/** Parse object MCP servers thành danh sách hiển thị */
export function parseServers(raw: Record<string, any>): McpServerInfo[] {
  return Object.entries(raw).map(([name, cfg]: [string, any]) => ({
    name,
    command: cfg.command || '—',
    args: cfg.args || [],
    type: cfg.type || 'stdio',
    envKeys: cfg.env ? Object.keys(cfg.env) : [],
  }));
}

interface McpServerListProps {
  servers: McpServerInfo[];
  runtimeStatus: McpRuntimeServer[];
}

/** Render danh sách server cards — dùng chung cho cả 2 tab (Global/Project) */
const McpServerList: React.FC<McpServerListProps> = ({ servers, runtimeStatus }) => {
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

  return (
    <>
      {servers.map((srv) => {
        // Tìm runtime status tương ứng cho server này
        const runtime = runtimeStatus.find(r => r.name === srv.name);
        const isConnected = runtime?.status === 'connected';
        const isFailed = runtime?.status === 'failed';
        const hasRuntime = !!runtime;
        const toolCount = runtime?.tools?.length || 0;

        // Icon phản ánh trạng thái: connected=xanh, failed=đỏ, pending=vàng, chưa có=xám
        const statusIcon = !hasRuntime
          ? <InfoCircleFilled style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12 }} />
          : isConnected
            ? <CheckCircleFilled style={{ color: '#00b894', fontSize: 12 }} />
            : isFailed
              ? <InfoCircleFilled style={{ color: '#ff6b6b', fontSize: 12 }} />
              : <LoadingOutlined style={{ color: '#fdcb6e', fontSize: 12 }} spin />;

        // Tag text
        const statusTag = hasRuntime
          ? isConnected ? { color: 'green' as const, text: 'Connected' }
            : isFailed ? { color: 'red' as const, text: 'Failed' }
            : { color: 'gold' as const, text: 'Connecting...' }
          : null;

        return (
          <div key={srv.name} className="mcp-server-card">
            {/* Tên server + type tag + status */}
            <div className="mcp-server-header">
              {statusIcon}
              <span className="mcp-server-name">{srv.name}</span>
              <Tag className="mcp-server-type-tag">{srv.type}</Tag>
              {statusTag && (
                <Tag
                  color={statusTag.color}
                  style={{ fontSize: 9, lineHeight: '16px', marginLeft: 'auto' }}
                >
                  {statusTag.text}
                </Tag>
              )}
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

            {/* Runtime info: số tools khả dụng */}
            {hasRuntime && isConnected && toolCount > 0 && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                {toolCount} tools khả dụng
              </div>
            )}

            {/* Lỗi kết nối */}
            {isFailed && runtime?.error && (
              <div style={{ fontSize: 10, color: '#ff6b6b', marginTop: 2 }}>
                {runtime.error}
              </div>
            )}

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
        );
      })}
    </>
  );
};

export default McpServerList;
