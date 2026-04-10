import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button, Tooltip, Dropdown, Popover } from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  StopOutlined,
  ThunderboltOutlined,
  SafetyCertificateOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LockOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { claudeApi } from '../../services/api';
import type { SlashCommand, ModelInfo } from '../../services/api';
import type { PendingPermission } from '../../hooks/useChat';

/**
 * Mô tả ngắn gọn các tool phổ biến của Claude CLI.
 * Dùng cho popover giải thích tool khi permission panel hiện.
 * Key là tên tool SDK trả về (case-sensitive).
 */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  Write: 'Ghi nội dung vào file. Tạo mới hoặc ghi đè file hiện có.',
  Read: 'Đọc nội dung file từ hệ thống.',
  Edit: 'Chỉnh sửa một phần file hiện có (tìm và thay thế).',
  Glob: 'Tìm kiếm file theo pattern (ví dụ: *.ts, src/**/*.tsx).',
  Grep: 'Tìm kiếm nội dung trong file theo regex hoặc chuỗi.',
  Bash: 'Thực thi lệnh shell trên hệ thống.',
  MultiEdit: 'Thực hiện nhiều chỉnh sửa cùng lúc trên một file.',
  LS: 'Liệt kê nội dung thư mục.',
  WebSearch: 'Tìm kiếm trên web.',
  WebFetch: 'Tải nội dung từ URL.',
  TodoRead: 'Đọc danh sách todo/task.',
  TodoWrite: 'Cập nhật danh sách todo/task.',
};

/**
 * Lấy mô tả tool — hỗ trợ cả tool MCP (prefix mcp__).
 * Nếu không tìm thấy mô tả, trả về null.
 */
function getToolDescription(toolName: string): string | null {
  // Tìm chính xác
  if (TOOL_DESCRIPTIONS[toolName]) return TOOL_DESCRIPTIONS[toolName];

  // Tool MCP có dạng: mcp__<server>__<tool_name>
  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const server = parts[1] || '';
    const tool = parts.slice(2).join('__') || '';
    return `Tool MCP từ server "${server}": ${tool}`;
  }

  return null;
}

/**
 * Mô tả chi tiết cho từng model.
 * Dùng trong popover dấu hỏi trên dropdown model.
 */
const MODEL_HELP: Record<string, { title: string; desc: string }> = {
  sonnet: {
    title: 'Claude Sonnet',
    desc: 'Model cân bằng giữa tốc độ và chất lượng. Phù hợp cho hầu hết tác vụ coding thông thường.',
  },
  opus: {
    title: 'Claude Opus',
    desc: 'Model mạnh nhất, suy luận sâu. Dùng cho tác vụ phức tạp, kiến trúc hệ thống, debug khó.',
  },
  haiku: {
    title: 'Claude Haiku',
    desc: 'Model nhanh nhất, chi phí thấp. Phù hợp cho câu hỏi đơn giản, refactor nhỏ.',
  },
};

/**
 * Mô tả chi tiết cho từng effort level.
 * Dùng trong popover dấu hỏi trên dropdown effort.
 */
const EFFORT_HELP: Record<string, { title: string; desc: string }> = {
  low: {
    title: 'Mức thấp',
    desc: 'Trả lời nhanh, ít suy nghĩ. Tiết kiệm token nhưng có thể bỏ sót chi tiết. Phù hợp cho câu hỏi đơn giản.',
  },
  medium: {
    title: 'Mức trung bình',
    desc: 'Cân bằng giữa tốc độ và chất lượng. Mức mặc định, phù hợp cho đa số tác vụ.',
  },
  high: {
    title: 'Mức cao',
    desc: 'Suy nghĩ kỹ, phân tích sâu. Tốn nhiều token hơn nhưng cho kết quả chi tiết và chính xác nhất.',
  },
};

/**
 * Mô tả chi tiết cho từng permission mode.
 * Dùng trong popover dấu hỏi trên dropdown permission.
 */
const PERMISSION_HELP: Record<string, { title: string; desc: string }> = {
  default: {
    title: 'Chế độ mặc định',
    desc: 'Claude sẽ hỏi xác nhận trước khi thực hiện bất kỳ thao tác nào ảnh hưởng đến file hoặc hệ thống.',
  },
  acceptEdits: {
    title: 'Chấp nhận chỉnh sửa',
    desc: 'Tự động chấp nhận đọc/ghi file. Vẫn hỏi trước khi chạy lệnh shell hoặc thao tác nguy hiểm.',
  },
  bypassPermissions: {
    title: 'Bỏ qua tất cả quyền',
    desc: '⚠️ Không hỏi bất kỳ quyền nào. Claude tự do thực thi mọi tool. Chỉ dùng khi bạn hoàn toàn tin tưởng.',
  },
  plan: {
    title: 'Chỉ lập kế hoạch',
    desc: 'Claude chỉ phân tích và đề xuất. Không thực thi bất kỳ tool nào. An toàn để review trước.',
  },
  dontAsk: {
    title: 'Không hỏi',
    desc: 'Tương tự bỏ qua quyền — Claude sẽ tự động thực hiện mọi thứ mà không cần xác nhận.',
  },
};

/**
 * Render icon dấu hỏi kèm Popover mô tả cho một option.
 * Dùng chung cho cả 3 dropdown (model, effort, permission).
 */
function HelpIcon({ title, desc }: { title: string; desc: string }) {
  return (
    <Popover
      content={
        <div style={{ maxWidth: 260 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 13 }}>{title}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 }}>{desc}</div>
        </div>
      }
      trigger="hover"
      placement="right"
      mouseEnterDelay={0.3}
    >
      <QuestionCircleOutlined
        className="menu-item-help"
        onClick={(e) => e.stopPropagation()}
      />
    </Popover>
  );
}

interface InputBoxProps {
  onSend: (message: string) => void;
  disabled: boolean;
  isThinking: boolean;
  /** Model hiện tại */
  currentModel?: string;
  /** Callback khi đổi model */
  onModelChange?: (model: string) => void;
  /** Callback khi abort */
  onAbort?: () => void;
  /** Effort level hiện tại của session */
  effortLevel?: string;
  /** Callback khi đổi effort level */
  onEffortChange?: (level?: string) => void;
  /** Permission mode hiện tại của session */
  permissionMode?: string;
  /** Callback khi đổi permission mode */
  onPermissionModeChange?: (mode?: string) => void;
  /** Tool đang chờ xác nhận permission */
  pendingPermission?: PendingPermission | null;
  /** Callback phản hồi permission: true = cho phép, false = từ chối */
  onRespondPermission?: (allowed: boolean) => void;
}

const InputBox: React.FC<InputBoxProps> = ({
  onSend,
  disabled,
  isThinking,
  currentModel = 'sonnet',
  onModelChange,
  onAbort,
  effortLevel,
  onEffortChange,
  permissionMode,
  onPermissionModeChange,
  pendingPermission,
  onRespondPermission,
}) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Danh sách commands và models từ API
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);

  // State cho slash command popup
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  // Load danh sách commands + models từ backend (1 lần)
  useEffect(() => {
    claudeApi.getCommands()
      .then(setCommands)
      .catch(() => {
        setCommands([
          { cmd: '/help', desc: 'Danh sách lệnh', source: 'builtin' },
          { cmd: '/compact', desc: 'Nén ngữ cảnh', source: 'builtin' },
          { cmd: '/model', desc: 'Đổi model', source: 'builtin' },
        ]);
      });

    claudeApi.getModels()
      .then(data => setModels(data.models))
      .catch(() => {
        setModels([
          { key: 'sonnet', label: 'Sonnet' },
          { key: 'opus', label: 'Opus' },
          { key: 'haiku', label: 'Haiku' },
        ]);
      });
  }, []);

  /** Gửi tin nhắn */
  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    setShowSlashMenu(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  /** Lọc slash commands theo input */
  const filteredCommands = commands.filter(c =>
    c.cmd.toLowerCase().includes(slashFilter.toLowerCase())
  );

  /** Chèn slash command vào input */
  const insertSlashCommand = useCallback((cmd: string) => {
    setValue(cmd + ' ');
    setShowSlashMenu(false);
    setSlashFilter('');
    textareaRef.current?.focus();
  }, []);

  /** Xử lý phím bấm */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash menu đang mở — xử lý navigation
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex(i => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(i => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertSlashCommand(filteredCommands[slashIndex].cmd);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    // Enter gửi, Shift+Enter xuống dòng
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  /** Xử lý input thay đổi */
  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setValue(newVal);

    // Phát hiện slash command — chỉ khi ở đầu dòng, bắt đầu bằng "/"
    if (newVal.startsWith('/') && !newVal.includes('\n')) {
      setShowSlashMenu(true);
      setSlashFilter(newVal);
      setSlashIndex(0);
    } else {
      setShowSlashMenu(false);
      setSlashFilter('');
    }

    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  // Đóng slash menu khi click bên ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setShowSlashMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cuộn item đang chọn vào view
  useEffect(() => {
    if (showSlashMenu && slashMenuRef.current) {
      const active = slashMenuRef.current.querySelector('.slash-item.active');
      active?.scrollIntoView({ block: 'nearest' });
    }
  }, [slashIndex, showSlashMenu]);

  /** Menu chọn model — kèm icon dấu hỏi mô tả từng model */
  const modelMenuItems: MenuProps['items'] = models.map(m => {
    const help = MODEL_HELP[m.key];
    return {
      key: m.key,
      label: (
        <div className="model-menu-item">
          <span className="model-menu-name">{m.label}</span>
          {m.modelId && <span className="model-menu-desc">{m.modelId}</span>}
          {help && <HelpIcon title={help.title} desc={help.desc} />}
        </div>
      ),
    };
  });

  const currentModelLabel = models.find(m => m.key === currentModel)?.label || currentModel;

  return (
    <div className="input-box-wrapper">
      {/* Panel xác nhận permission — dính phía trên input box, giống slash-menu */}
      {pendingPermission && (
        <div className="permission-panel">
          <div className="permission-panel-header">
            <LockOutlined className="permission-panel-icon" />
            <span className="permission-panel-title">Xác nhận quyền</span>
          </div>
          <div className="permission-panel-body">
            <p className="permission-panel-desc">
              Claude muốn sử dụng tool:{' '}
              <strong style={{ color: 'var(--accent)' }}>{pendingPermission.toolName}</strong>
              {(() => {
                const desc = getToolDescription(pendingPermission.toolName);
                if (!desc) return null;
                return (
                  <Popover
                    content={<span style={{ fontSize: 12, maxWidth: 260, display: 'block' }}>{desc}</span>}
                    trigger="hover"
                    placement="top"
                  >
                    <QuestionCircleOutlined className="permission-tool-help" />
                  </Popover>
                );
              })()}
            </p>
            <pre className="permission-panel-code">
              {JSON.stringify(pendingPermission.input, null, 2)}
            </pre>
          </div>
          <div className="permission-panel-actions">
            <button
              className="permission-btn permission-btn-deny"
              onClick={() => onRespondPermission?.(false)}
            >
              <CloseCircleOutlined /> Từ chối
            </button>
            <button
              className="permission-btn permission-btn-allow"
              onClick={() => onRespondPermission?.(true)}
            >
              <CheckCircleOutlined /> Cho phép
            </button>
          </div>
        </div>
      )}

      {/* Slash command popup */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <div className="slash-menu" ref={slashMenuRef}>
          <div className="slash-menu-title">Lệnh Claude</div>
          {filteredCommands.map((c, i) => (
            <div
              key={c.cmd}
              className={`slash-item ${i === slashIndex ? 'active' : ''}`}
              onClick={() => insertSlashCommand(c.cmd)}
              onMouseEnter={() => setSlashIndex(i)}
            >
              <span className="slash-cmd">{c.cmd}</span>
              <span className="slash-desc">{c.desc}</span>
              {c.source !== 'builtin' && (
                <span className="slash-source">{c.source}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toolbar: model selector + effort level */}
      <div className="input-toolbar">
        <Dropdown
          menu={{
            items: modelMenuItems,
            onClick: ({ key }) => onModelChange?.(key),
            selectedKeys: [currentModel],
          }}
          trigger={['click']}
          placement="topLeft"
        >
          <button className="toolbar-btn" title="Chọn model">
            <RobotOutlined />
            <span>{currentModelLabel}</span>
          </button>
        </Dropdown>

        <Dropdown
          menu={{
            items: [
              {
                key: 'low',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name">Thấp</span>
                    <span className="model-menu-desc">Nhanh, tiết kiệm token</span>
                    <HelpIcon title={EFFORT_HELP.low.title} desc={EFFORT_HELP.low.desc} />
                  </div>
                ),
              },
              {
                key: 'medium',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name">Trung bình</span>
                    <span className="model-menu-desc">Cân bằng tốc độ/chất lượng</span>
                    <HelpIcon title={EFFORT_HELP.medium.title} desc={EFFORT_HELP.medium.desc} />
                  </div>
                ),
              },
              {
                key: 'high',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name">Cao</span>
                    <span className="model-menu-desc">Nỗ lực tối đa, chi tiết nhất</span>
                    <HelpIcon title={EFFORT_HELP.high.title} desc={EFFORT_HELP.high.desc} />
                  </div>
                ),
              },
            ],
            onClick: ({ key }) => onEffortChange?.(key),
            selectedKeys: [effortLevel || 'medium'],
          }}
          trigger={['click']}
          placement="topLeft"
        >
          <button className="toolbar-btn" title="Mức độ nỗ lực">
            <ThunderboltOutlined />
            <span>{effortLevel === 'low' ? 'Thấp' : effortLevel === 'high' ? 'Cao' : 'Trung bình'}</span>
          </button>
        </Dropdown>

        <Dropdown
          menu={{
            items: [
              {
                key: 'default',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name">Mặc định</span>
                    <span className="model-menu-desc">Hỏi trước khi thực hiện</span>
                    <HelpIcon title={PERMISSION_HELP.default.title} desc={PERMISSION_HELP.default.desc} />
                  </div>
                ),
              },
              {
                key: 'acceptEdits',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name">Chấp nhận sửa</span>
                    <span className="model-menu-desc">Tự động chấp nhận chỉnh sửa file</span>
                    <HelpIcon title={PERMISSION_HELP.acceptEdits.title} desc={PERMISSION_HELP.acceptEdits.desc} />
                  </div>
                ),
              },
              {
                key: 'bypassPermissions',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name">Bỏ qua quyền</span>
                    <span className="model-menu-desc">Không hỏi bất kỳ quyền nào</span>
                    <HelpIcon title={PERMISSION_HELP.bypassPermissions.title} desc={PERMISSION_HELP.bypassPermissions.desc} />
                  </div>
                ),
              },
              {
                key: 'plan',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name">Lập kế hoạch</span>
                    <span className="model-menu-desc">Chỉ lập kế hoạch, không thực thi</span>
                    <HelpIcon title={PERMISSION_HELP.plan.title} desc={PERMISSION_HELP.plan.desc} />
                  </div>
                ),
              },
              {
                key: 'dontAsk',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name">Không hỏi</span>
                    <span className="model-menu-desc">Không hỏi bất kỳ điều gì</span>
                    <HelpIcon title={PERMISSION_HELP.dontAsk.title} desc={PERMISSION_HELP.dontAsk.desc} />
                  </div>
                ),
              },
            ],
            onClick: ({ key }) => onPermissionModeChange?.(key),
            selectedKeys: permissionMode ? [permissionMode] : ['default'],
          }}
          trigger={['click']}
          placement="topLeft"
        >
          <button className="toolbar-btn" title="Chế độ quyền">
            <SafetyCertificateOutlined />
            <span>{permissionMode === 'acceptEdits' ? 'Chấp nhận sửa' : permissionMode === 'bypassPermissions' ? 'Bỏ qua quyền' : permissionMode === 'plan' ? 'Kế hoạch' : permissionMode === 'dontAsk' ? 'Không hỏi' : 'Mặc định'}</span>
          </button>
        </Dropdown>
      </div>

      {/* Input area */}
      <div className="input-box">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={isThinking ? 'Đang xử lý...' : 'Nhập tin nhắn hoặc / để xem lệnh...'}
          rows={1}
          disabled={disabled && !isThinking}
          spellCheck={false}
        />
        <div className="input-actions">
          {isThinking ? (
            <Tooltip title="Dừng (Abort)">
              <Button
                type="text"
                shape="circle"
                icon={<StopOutlined />}
                onClick={onAbort}
                className="abort-btn"
              />
            </Tooltip>
          ) : (
            <Tooltip title="Gửi (Enter)">
              <Button
                type="text"
                shape="circle"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!value.trim() || disabled}
                className="send-btn"
              />
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
};

export default InputBox;
