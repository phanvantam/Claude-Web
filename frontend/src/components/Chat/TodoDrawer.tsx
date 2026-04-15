import React, { useState, useEffect } from 'react';
import { Drawer, Empty, Typography } from 'antd';
import {
  CheckSquareOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';

interface TodoItem {
  content?: string;
  activeForm?: string;
  status?: string;
}

interface TodoDrawerProps {
  open: boolean;
  onClose: () => void;
  todos: TodoItem[];
}

const getTodoStatusIcon = (status: string) => {
  switch (status) {
    case 'completed':
      return <CheckCircleOutlined style={{ color: '#51cf66', fontSize: 13 }} />;
    case 'in_progress':
      return <LoadingOutlined style={{ color: '#e17055', fontSize: 13 }} spin />;
    default:
      return <span className="todo-pending-dot" />;
  }
};

const STATUS_ORDER = ['in_progress', 'pending', 'completed'];
const STATUS_LABEL: Record<string, string> = {
  in_progress: 'Đang thực hiện',
  pending: 'Chưa bắt đầu',
  completed: 'Đã hoàn thành',
};

const TodoDrawer: React.FC<TodoDrawerProps> = ({ open, onClose, todos }) => {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const incompleteCount = todos.filter(t => t.status !== 'completed').length;

  const grouped = STATUS_ORDER.reduce<Record<string, TodoItem[]>>((acc, status) => {
    acc[status] = todos.filter(t => t.status === status);
    return acc;
  }, {} as Record<string, TodoItem[]>);

  return (
    <Drawer
      className="mcp-drawer todo-drawer"
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <CheckSquareOutlined style={{ color: 'var(--accent)', fontSize: 16 }} />
          <span>Danh sách Todo</span>
          {incompleteCount > 0 && (
            <span style={{
              background: 'rgba(108, 92, 231, 0.2)',
              color: 'var(--accent)',
              fontSize: 11,
              padding: '1px 8px',
              borderRadius: 10,
              fontWeight: 600,
            }}>
              {incompleteCount}
            </span>
          )}
        </div>
      }
      placement="right"
      onClose={onClose}
      open={open}
      styles={{
        wrapper: { width: isMobile ? '100%' : 380 },
        header: {
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border)',
        },
        body: {
          background: 'var(--bg-primary)',
          padding: '12px',
        },
      }}
    >
      {todos.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <Typography.Text style={{ color: 'var(--text-muted)', fontSize: 13 }}>
              Chưa có task nào trong phiên này
            </Typography.Text>
          }
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {STATUS_ORDER.map(status => {
            const items = grouped[status];
            if (!items || items.length === 0) return null;

            return (
              <div key={status}>
                <div style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}>
                  {STATUS_LABEL[status]} ({items.length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {items.map((todo, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: status === 'in_progress'
                          ? 'rgba(225, 112, 85, 0.08)'
                          : status === 'completed'
                            ? 'rgba(81, 207, 102, 0.06)'
                            : 'var(--bg-card)',
                        border: '1px solid var(--border)',
                      }}
                    >
                      <span style={{ marginTop: 2, flexShrink: 0 }}>
                        {getTodoStatusIcon(status)}
                      </span>
                      <span style={{
                        fontSize: 13,
                        color: status === 'completed'
                          ? 'var(--text-muted)'
                          : 'var(--text-primary)',
                        textDecoration: status === 'completed' ? 'line-through' : 'none',
                        lineHeight: 1.4,
                      }}>
                        {status === 'in_progress' && todo.activeForm
                          ? todo.activeForm
                          : todo.content || ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Drawer>
  );
};

export default TodoDrawer;
