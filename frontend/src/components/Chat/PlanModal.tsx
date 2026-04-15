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
  /** Callback báo plan vừa bắt đầu thực thi */
  onExecutionStarted?: (filename: string) => void;
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
  onExecutionStarted,
}) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [content, setContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [activeTab, setActiveTab] = useState<'preview' | 'edit'>('preview');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [executeModalOpen, setExecuteModalOpen] = useState(false);
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
    // Normalize filename giống handleSave
    const normalizedFilename = (filename || newFilename.trim());
    const planFilename = normalizedFilename.endsWith('.md')
      ? normalizedFilename
      : `${normalizedFilename}.md`;

    if (!planFilename || planFilename === '.md') {
      message.warning('Vui lòng lưu kế hoạch trước khi thực thi');
      return;
    }
    setExecuteModalOpen(true);
  }, [filename, newFilename]);

  const doConfirmExecute = useCallback(async () => {
    const normalizedFilename = (filename || newFilename.trim());
    const planFilename = normalizedFilename.endsWith('.md')
      ? normalizedFilename
      : `${normalizedFilename}.md`;
    if (!planFilename || planFilename === '.md' || !projectId) return;

    // Cập nhật trạng thái thành in_progress
    try {
      await planApi.updateStatus(projectId, planFilename, 'in_progress');
    } catch {
      // Không chặn execution nếu update thất bại
    }

    // Không tự động đổi permission mode khi thực thi kế hoạch.
    // User tự chọn mode trước khi bấm "Thực thi".

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

    // Báo cho ChatPage biết plan nào đang được thực thi
    if (onExecutionStarted) {
      onExecutionStarted(planFilename);
    }

    onExecute(promptLines.join('\n'));
    setExecuteModalOpen(false);
    setAdditionalInstructions('');
    onClose();
    onChanged(); // Refresh danh sách plan ngay để badge đổi
    message.info('Đã gửi lệnh thực thi kế hoạch');
  }, [filename, newFilename, additionalInstructions, onExecute, onClose, projectId, onExecutionStarted, onChanged]);

  const title = isNew ? 'Tạo kế hoạch mới' : filename;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, width: '100%', paddingRight: 32 }}>
          <span style={{ color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
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
      }
      width={980}
      style={{ maxWidth: '96vw', top: 24 }}
      styles={{ body: { minHeight: '78vh', maxHeight: 'calc(100vh - 96px)', overflow: 'auto' } }}
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
                    autoSize={{ minRows: 20, maxRows: 40 }}
                    className="plan-editor-textarea"
                    spellCheck={false}
                    placeholder="Nội dung Markdown..."
                  />
                ),
              },
            ]}
          />

          {/* Actions - đã chuyển lên header, xóa phần này */}
        </div>
      )}

      {/* Modal xác nhận thực thi */}
      <Modal
        open={executeModalOpen}
        onCancel={() => { setExecuteModalOpen(false); setAdditionalInstructions(''); }}
        onOk={doConfirmExecute}
        title="Xác nhận thực thi kế hoạch"
        okText="Thực thi"
        cancelText="Hủy"
        okButtonProps={{ style: { background: '#00b894' } }}
        width={520}
        className="plan-modal"
      >
        <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text-secondary)' }}>
          Bạn có thể thêm chỉ thị bổ sung trước khi thực thi:
        </div>
        <Input.TextArea
          value={additionalInstructions}
          onChange={(e) => setAdditionalInstructions(e.target.value)}
          autoSize={{ minRows: 3, maxRows: 8 }}
          className="plan-editor-textarea"
          placeholder="Ví dụ: Ưu tiên xử lý phần backend trước, bỏ qua bước 3..."
        />
      </Modal>
    </Modal>
  );
};

export default PlanModal;
