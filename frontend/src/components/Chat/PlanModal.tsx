import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Input, message, Tabs, Tooltip } from 'antd';
import {
  SaveOutlined,
  PlayCircleOutlined,
  EditOutlined,
  EyeOutlined,
  DeleteOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { planApi } from '../../services/api';
import MessageContent from './MessageContent';

interface PlanModalProps {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  /** Tên file plan đang xem — null khi tạo mới */
  filename: string | null;
  /** Callback gửi tin nhắn thực thi vào phiên chat hiện tại */
  onExecute: (text: string) => void;
  /** Callback sau khi lưu/xóa thành công — PlanDrawer sẽ refresh danh sách */
  onChanged: () => void;
  /** Permission mode hiện tại của session */
  permissionMode?: string;
  /** Callback thay đổi permission mode — dùng khi tự động chuyển mode lúc thực thi */
  onPermissionModeChange?: (mode: string) => void;
}

/**
 * Modal xem chi tiết và chỉnh sửa file kế hoạch.
 * - Tab Preview: render Markdown
 * - Tab Edit: TextArea chỉnh sửa nội dung
 */
const PlanModal: React.FC<PlanModalProps> = ({
  open,
  onClose,
  projectId,
  filename,
  onExecute,
  onChanged,
  permissionMode,
  onPermissionModeChange,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'edit'>('preview');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  /** Tên file khi tạo mới — cho user nhập */
  const [newFilename, setNewFilename] = useState('');
  const isNew = !filename;

  /** Tải nội dung plan từ backend */
  const loadContent = useCallback(async () => {
    if (!projectId || !filename) return;
    setLoading(true);
    try {
      const data = await planApi.get(projectId, filename);
      if (data.found) {
        setContent(data.content || '');
        setEditContent(data.content || '');
      }
    } catch {
      message.error('Lỗi tải nội dung kế hoạch');
    } finally {
      setLoading(false);
    }
  }, [projectId, filename]);

  useEffect(() => {
    if (open) {
      setAdditionalInstructions('');
      if (isNew) {
        // Tạo mới — template mặc định
        setActiveTab('edit');
        setNewFilename('');
        const template = '# Kế hoạch thực hiện\n\n## Mục tiêu\n\n\n## Phân tích hiện trạng\n\n\n## Các bước thực hiện\n\n1. \n2. \n3. \n\n## Rủi ro\n\n- \n';
        setContent(template);
        setEditContent(template);
      } else {
        setActiveTab('preview');
        loadContent();
      }
    }
  }, [open, isNew, loadContent]);

  /** Lưu file kế hoạch */
  const handleSave = useCallback(async () => {
    if (!projectId) return;

    const normalizedFilename = newFilename.trim();
    const targetFilename = isNew
      ? (normalizedFilename || 'new-plan') + (normalizedFilename.endsWith('.md') ? '' : '.md')
      : filename!;

    setSaving(true);
    try {
      await planApi.save(projectId, editContent, targetFilename);
      setContent(editContent);
      setActiveTab('preview');
      message.success('Đã lưu kế hoạch');
      onChanged();
    } catch (err: any) {
      message.error(err.message || 'Lỗi khi lưu');
    } finally {
      setSaving(false);
    }
  }, [projectId, filename, isNew, newFilename, editContent, onChanged]);

  /** Xóa file kế hoạch */
  const handleDelete = useCallback(async () => {
    if (!projectId || !filename) return;
    Modal.confirm({
      title: 'Xác nhận xóa',
      icon: <ExclamationCircleOutlined />,
      content: `Bạn có chắc muốn xóa file "${filename}"?`,
      okText: 'Xóa',
      okType: 'danger',
      cancelText: 'Hủy',
      onOk: async () => {
        try {
          await planApi.delete(projectId, filename);
          message.success('Đã xóa file kế hoạch');
          onChanged();
          onClose();
        } catch (err: any) {
          message.error(err.message || 'Lỗi khi xóa');
        }
      },
    });
  }, [projectId, filename, onChanged, onClose]);

  /** Gửi lệnh thực thi kế hoạch vào phiên chat — Tự động chuyển mode khi bấm */
  const handleExecute = useCallback(() => {
    const planFilename = filename || newFilename;
    if (!planFilename) {
      message.warning('Vui lòng lưu kế hoạch trước khi thực thi');
      return;
    }

    // Tự động chuyển từ chế độ "Kế hoạch" sang "Chấp nhận sửa" để Claude có quyền thực thi
    if (permissionMode === 'plan' && onPermissionModeChange) {
      onPermissionModeChange('acceptEdits');
      message.info('Đã chuyển sang chế độ "Chấp nhận sửa" để thực thi kế hoạch');
    }

    // Xây dựng prompt thực thi chi tiết — Claude sẽ đọc file và báo cáo tiến độ
    const promptLines = [
      `Đọc và thực thi kế hoạch trong file .claude/plans/${planFilename}.`,
      '',
      'Yêu cầu:',
      '1. Đọc kỹ toàn bộ nội dung file kế hoạch trước khi bắt đầu.',
      '2. Thực hiện từng bước theo đúng thứ tự.',
      '3. Sau mỗi bước, báo cáo ngắn gọn: [DONE] Bước X: [mô tả] — Hoàn thành.',
      '4. Nếu gặp vấn đề ở bước nào, dừng lại và thông báo trước khi tiếp tục.',
    ];

    if (additionalInstructions.trim()) {
      promptLines.push('', 'Chỉ thị bổ sung:', additionalInstructions.trim());
    }

    onExecute(promptLines.join('\n'));
    onClose();
    message.info('Đã gửi lệnh thực thi kế hoạch');
  }, [filename, newFilename, additionalInstructions, onExecute, onClose, permissionMode, onPermissionModeChange]);

  const title = isNew ? 'Tạo kế hoạch mới' : filename;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--text-primary)' }}>{title}</span>
        </div>
      }
      width={720}
      className="plan-modal"
      footer={null}
      destroyOnClose
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          Đang tải...
        </div>
      ) : (
        <div className="plan-modal-body">
          {/* Tên file khi tạo mới */}
          {isNew && (
            <div className="plan-modal-filename">
              <Input
                placeholder="Tên file (ví dụ: refactor-auth-module)"
                value={newFilename}
                onChange={(e) => setNewFilename(e.target.value)}
                addonAfter=".md"
                size="small"
                className="plan-filename-input"
              />
            </div>
          )}

          {/* Tab Preview / Edit */}
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as 'preview' | 'edit')}
            size="small"
            className="plan-modal-tabs"
            items={[
              {
                key: 'preview',
                label: (
                  <span><EyeOutlined /> Xem trước</span>
                ),
                children: (
                  <div className="plan-preview plan-modal-content">
                    <MessageContent content={activeTab === 'preview' ? (editContent || content) : content} />
                  </div>
                ),
              },
              {
                key: 'edit',
                label: (
                  <span><EditOutlined /> Chỉnh sửa</span>
                ),
                children: (
                  <Input.TextArea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    autoSize={{ minRows: 12, maxRows: 24 }}
                    className="plan-editor-textarea"
                    spellCheck={false}
                    placeholder="Nội dung Markdown..."
                  />
                ),
              },
            ]}
          />

          {/* Phần thực thi — chỉ thị bổ sung + nút action */}
          <div className="plan-modal-execute">
            <div className="plan-modal-execute-label">Chỉ thị bổ sung khi thực thi</div>
            <Input.TextArea
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
              autoSize={{ minRows: 2, maxRows: 5 }}
              className="plan-editor-textarea"
              placeholder="Ví dụ: Ưu tiên xử lý phần backend trước, bỏ qua bước 3..."
            />
          </div>

          {/* Actions */}
          <div className="plan-modal-actions">
            <div style={{ display: 'flex', gap: 8 }}>
              {!isNew && (
                <Tooltip title="Xóa file kế hoạch">
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={handleDelete}
                  />
                </Tooltip>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                size="small"
                icon={<SaveOutlined />}
                onClick={handleSave}
                loading={saving}
              >
                Lưu
              </Button>
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={handleExecute}
                style={{ background: '#00b894' }}
              >
                Thực thi
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
};

export default PlanModal;
