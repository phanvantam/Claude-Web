import React, { useState, useEffect, useCallback } from 'react';
import { Drawer, Button, Empty, Tooltip, List } from 'antd';
import {
  FileTextOutlined,
  ReloadOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { planApi } from '../../services/api';
import type { PlanFileInfo } from '../../services/api';
import PlanModal from './PlanModal';

interface PlanDrawerProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  /** Callback gửi tin nhắn thực thi vào phiên chat hiện tại */
  onExecute?: (text: string) => void;
  /** Permission mode hiện tại của session — truyền xuống PlanModal */
  permissionMode?: string;
  /** Callback thay đổi permission mode — dùng khi tự động chuyển mode lúc thực thi */
  onPermissionModeChange?: (mode: string) => void;
}

/**
 * Drawer hiển thị danh sách file kế hoạch trong .claude/plans/.
 * Click vào item → mở PlanModal để xem/sửa/thực thi.
 */
const PlanDrawer: React.FC<PlanDrawerProps> = ({ open, onClose, projectId, onExecute, permissionMode, onPermissionModeChange }) => {
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<PlanFileInfo[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedFilename, setSelectedFilename] = useState<string | null>(null);

  /** Full-width drawer trên mobile */
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  /** Tải danh sách plans từ backend */
  const loadPlans = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await planApi.list(projectId);
      setPlans(data.plans || []);
    } catch {
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  // Tải danh sách khi mở drawer
  useEffect(() => {
    if (open) loadPlans();
  }, [open, loadPlans]);

  /** Mở modal để xem/sửa file cụ thể */
  const handleOpenPlan = (filename: string) => {
    setSelectedFilename(filename);
    setModalOpen(true);
  };

  /** Mở modal tạo kế hoạch mới */
  const handleCreateNew = () => {
    setSelectedFilename(null);
    setModalOpen(true);
  };

  /** Callback khi PlanModal lưu/xóa xong — refresh danh sách */
  const handlePlanChanged = () => {
    loadPlans();
  };

  /** Callback đẩy lệnh thực thi vào chat */
  const handleExecute = (text: string) => {
    if (onExecute) {
      onExecute(text);
      onClose(); // Đóng drawer sau khi thực thi
    }
  };

  /** Format ngày thành chuỗi ngắn gọn */
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = Math.floor(diffMs / 3600000);

    if (diffH < 1) return 'Vừa xong';
    if (diffH < 24) return `${diffH} giờ trước`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD} ngày trước`;
    return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  /** Format kích thước file */
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <>
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <FileTextOutlined style={{ color: '#00b894', fontSize: 16 }} />
            <span>Kế hoạch</span>
            {plans.length > 0 && (
              <span style={{
                background: 'rgba(0, 184, 148, 0.15)',
                color: '#00b894',
                fontSize: 10,
                padding: '1px 8px',
                borderRadius: 10,
                fontFamily: 'monospace',
              }}>
                {plans.length}
              </span>
            )}
          </div>
        }
        placement="right"
        open={open}
        onClose={onClose}
        className="mcp-drawer"
        extra={
          <div style={{ display: 'flex', gap: 4 }}>
            <Tooltip title="Tải lại">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={loadPlans}
                style={{ color: 'var(--text-secondary)' }}
              />
            </Tooltip>
            <Tooltip title="Tạo kế hoạch mới">
              <Button
                type="text"
                size="small"
                icon={<PlusOutlined />}
                onClick={handleCreateNew}
                style={{ color: '#00b894' }}
              />
            </Tooltip>
          </div>
        }
        styles={{
          wrapper: { width: isMobile ? '100%' : 420 },
          header: {
            background: 'rgba(22, 22, 38, 0.98)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          },
          body: {
            background: 'rgba(22, 22, 38, 0.98)',
            padding: '12px 16px',
          },
        }}
      >
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
            Đang tải...
          </div>
        ) : plans.length === 0 ? (
          <Empty
            description={
              <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                <p>Chưa có kế hoạch nào.</p>
                <p style={{ fontSize: 11, opacity: 0.7 }}>
                  Claude sẽ tạo file kế hoạch khi chạy ở chế độ "Lập kế hoạch".
                </p>
              </div>
            }
            imageStyle={{ height: 50 }}
            style={{ margin: '40px 0' }}
          >
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={handleCreateNew}
              style={{ background: '#00b894', borderColor: '#00b894' }}
            >
              Tạo kế hoạch mới
            </Button>
          </Empty>
        ) : (
          <List
            dataSource={plans}
            renderItem={(plan) => (
              <div
                className="plan-list-item"
                onClick={() => handleOpenPlan(plan.filename)}
              >
                <div className="plan-list-item-icon">
                  <FileTextOutlined />
                </div>
                <div className="plan-list-item-info">
                  <div className="plan-list-item-name">{plan.filename}</div>
                  <div className="plan-list-item-meta">
                    {formatDate(plan.updatedAt)} · {formatSize(plan.sizeBytes)}
                  </div>
                </div>
              </div>
            )}
          />
        )}
      </Drawer>

      {/* Modal xem/sửa/thực thi kế hoạch */}
      <PlanModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        projectId={projectId}
        filename={selectedFilename}
        onExecute={handleExecute}
        onChanged={handlePlanChanged}
        permissionMode={permissionMode}
        onPermissionModeChange={onPermissionModeChange}
      />
    </>
  );
};

export default PlanDrawer;
