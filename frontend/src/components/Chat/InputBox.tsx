import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Button, Tooltip, Dropdown } from 'antd';
import {
  SendOutlined,
  RobotOutlined,
  StopOutlined,
  ThunderboltOutlined,
  LockOutlined,
  TeamOutlined,
  EditOutlined,
  WarningOutlined,
  CarryOutOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { claudeApi } from '../../services/api';
import type { SlashCommand, ModelInfo } from '../../services/api';
import type { AgentInfo, InputBoxProps } from './InputBox/types';
import { MODEL_HELP, EFFORT_HELP, PERMISSION_HELP } from './InputBox/constants';
import HelpIcon from './InputBox/HelpIcon';
import AskUserPanel from './InputBox/AskUserPanel';
import PermissionPanel from './InputBox/PermissionPanel';
import SlashCommandPopup from './InputBox/SlashCommandPopup';


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
  pendingAskUser,
  onRespondAskUser,
  projectId,
  todoLists = [],
  onRemoveTodoList,
}) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Theo dõi mobile để set dropdown full-width */
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Danh sách commands và models từ API
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);

  // State cho slash command popup
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);

  // State cho @agent mention popup
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const [agentFilter, setAgentFilter] = useState('');
  const [agentIndex, setAgentIndex] = useState(0);
  const agentMenuRef = useRef<HTMLDivElement>(null);

  // Load danh sách commands + models từ backend (khi mount hoặc projectId đổi)
  useEffect(() => {
    claudeApi.getCommands(projectId)
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
          { key: 'sonnet', label: 'Claude Sonnet (Nhanh & Thông minh)' },
          { key: 'opus', label: 'Claude Opus (Mạnh nhất)' },
          { key: 'haiku', label: 'Claude Haiku (Nhanh & Rẻ)' },
        ]);
      });

    // Fetch danh sách agents cho @mention autocomplete — truyền projectId để scan đa scope
    claudeApi.listAgentsWithDesc(projectId)
      .then(setAgents)
      .catch(() => setAgents([]));
  }, [projectId]);

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

  /** Lọc agents theo text sau '@' */
  const filteredAgents = agents.filter(a =>
    a.name.toLowerCase().includes(agentFilter.toLowerCase())
  );

  /** Chèn @agent-name vào input — replace text sau '@' hoặc nối thêm nếu không có @ */
  const insertAgent = useCallback((name: string) => {
    setValue(prev => {
      const match = prev.match(/@[a-zA-Z0-9_-]*$/);
      if (match) {
        // Đang gõ @... ở cuối → replace
        return prev.replace(/@[a-zA-Z0-9_-]*$/, `@${name} `);
      } else {
        // Không có @ ở cuối (bấm nút Agent) → nối thêm
        const spacer = prev.length > 0 && !prev.endsWith(' ') && !prev.endsWith('\n') ? ' ' : '';
        return prev + spacer + `@${name} `;
      }
    });
    setShowAgentMenu(false);
    setAgentFilter('');
    textareaRef.current?.focus();
  }, []);

  /** Mobile/Desktop: nút Agent mở cùng picker như khi gõ @ */
  const handleOpenAgentPicker = useCallback(() => {
    setShowSlashMenu(false);
    setShowAgentMenu(true);
    setAgentFilter('');
    setAgentIndex(0);
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

    // Agent menu đang mở — xử lý navigation
    if (showAgentMenu && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAgentIndex(i => (i + 1) % filteredAgents.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAgentIndex(i => (i - 1 + filteredAgents.length) % filteredAgents.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertAgent(filteredAgents[agentIndex].name);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowAgentMenu(false);
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
      setShowAgentMenu(false);
    } else {
      setShowSlashMenu(false);
      setSlashFilter('');
    }

    // Phát hiện @agent mention — trigger khi gõ '@' không trong slash command
    const atMatch = newVal.match(/@([a-zA-Z0-9_-]*)$/);
    if (atMatch && !newVal.startsWith('/') && agents.length > 0) {
      setShowAgentMenu(true);
      setAgentFilter(atMatch[1]);
      setAgentIndex(0);
    } else {
      setShowAgentMenu(false);
      setAgentFilter('');
    }

    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  // Đóng slash menu và agent menu khi click bên ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (slashMenuRef.current && !slashMenuRef.current.contains(e.target as Node)) {
        setShowSlashMenu(false);
      }
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setShowAgentMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Cuộn item đang chọn vào view (slash menu hoặc agent menu)
  useEffect(() => {
    if (showSlashMenu && slashMenuRef.current) {
      const active = slashMenuRef.current.querySelector('.slash-item.active');
      active?.scrollIntoView({ block: 'nearest' });
    }
    if (showAgentMenu && agentMenuRef.current) {
      const active = agentMenuRef.current.querySelector('.slash-item.active');
      active?.scrollIntoView({ block: 'nearest' });
    }
  }, [slashIndex, showSlashMenu, agentIndex, showAgentMenu]);

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

  // Tìm model object khớp nhất để highlight trong menu và hiển thị label
  const matchedModel = useMemo(() => {
    const normalized = currentModel.replace(/\[.*\]/, '').trim();
    return models.find(m => 
      m.key === currentModel || 
      m.key === normalized || 
      m.modelId === currentModel || 
      m.modelId === normalized ||
      (m.modelId && (currentModel.startsWith(m.modelId) || m.modelId.startsWith(currentModel)))
    );
  }, [currentModel, models]);

  const currentModelLabel = 
    matchedModel?.shortLabel || 
    matchedModel?.label || 
    currentModel;

  const selectedModelKeys = matchedModel ? [matchedModel.key] : [currentModel];

  const latestTodoList = todoLists[0];

  const hasIncompleteTodos = latestTodoList
    ? latestTodoList.todos.some(todo => todo.status !== 'completed')
    : false;

  type MenuItem = NonNullable<MenuProps['items']>[number];

  const handleRemoveTodoList = useCallback((e: React.MouseEvent, listId: string) => {
    e.preventDefault();
    e.stopPropagation();
    onRemoveTodoList?.(listId);
  }, [onRemoveTodoList]);

  return (
    <div className="input-box-wrapper">
      {/* Panel xác nhận permission — dính phía trên input box, giống slash-menu */}
      {pendingPermission && (
        <PermissionPanel
          pendingPermission={pendingPermission}
          onRespondPermission={onRespondPermission}
        />
      )}

      {/* AskUserQuestion panel — hiện khi Claude hỏi user qua tool tương tác */}
      {pendingAskUser && (
        <AskUserPanel
          pendingAskUser={pendingAskUser}
          onRespond={(answer) => onRespondAskUser?.(answer)}
        />
      )}

      {/* Slash command popup */}
      {showSlashMenu && filteredCommands.length > 0 && (
        <SlashCommandPopup
          title="Lệnh Claude"
          menuRef={slashMenuRef}
          activeIndex={slashIndex}
          items={filteredCommands.map((c, i) => ({
            key: c.cmd,
            cmd: c.cmd,
            desc: c.desc,
            source: c.source !== 'builtin' ? c.source : undefined,
            onSelect: () => insertSlashCommand(c.cmd),
            onHover: () => setSlashIndex(i),
            helpContent: c.desc ? (
              <span>
                {c.desc}
                {c.source !== 'builtin' && (
                  <span style={{ display: 'block', marginTop: 4, color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
                    Nguồn: {c.source}
                  </span>
                )}
              </span>
            ) : undefined,
          }))}
        />
      )}

      {/* @Agent mention popup — tương tự slash-menu, trigger bằng '@' */}
      {showAgentMenu && filteredAgents.length > 0 && (
        <SlashCommandPopup
          title="Agents"
          menuRef={agentMenuRef}
          activeIndex={agentIndex}
          items={filteredAgents.map((a, i) => ({
            key: `${a.scope || 'user'}-${a.name}`,
            cmd: `@${a.name}`,
            desc: a.description || a.name,
            source: a.scope && a.scope !== 'user' ? a.scope : undefined,
            onSelect: () => insertAgent(a.name),
            onHover: () => setAgentIndex(i),
            helpContent: a.description ? (
              <span>
                {a.description}
                {a.model && <span style={{ display: 'block', marginTop: 4, color: 'rgba(255,255,255,0.5)', fontSize: 11 }}>Model: {a.model}</span>}
                {a.tools && a.tools.length > 0 && <span style={{ display: 'block', marginTop: 2, color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>Tools: {a.tools.join(', ')}</span>}
              </span>
            ) : undefined,
          }))}
        />
      )}

      {/* Toolbar: model selector + effort level */}
      <div className="input-toolbar">
        <Dropdown
          menu={{
            items: modelMenuItems,
            onClick: ({ key }) => onModelChange?.(key),
            selectedKeys: selectedModelKeys,
          }}
          trigger={['click']}
          placement="topLeft"
          overlayClassName="toolbar-dropdown"
          styles={{ root: isMobile ? { width: '100vw', left: 0 } : undefined }}
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
          overlayClassName="toolbar-dropdown"
          styles={{ root: isMobile ? { width: '100vw', left: 0 } : undefined }}
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
                    <span className="model-menu-name"><LockOutlined style={{ marginRight: 4 }} />Mặc định</span>
                    <span className="model-menu-desc">Hỏi trước khi thực hiện</span>
                    <HelpIcon title={PERMISSION_HELP.default.title} desc={PERMISSION_HELP.default.desc} />
                  </div>
                ),
              },
              {
                key: 'acceptEdits',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name"><EditOutlined style={{ marginRight: 4 }} />Chấp nhận sửa</span>
                    <span className="model-menu-desc">Tự động chấp nhận chỉnh sửa file</span>
                    <HelpIcon title={PERMISSION_HELP.acceptEdits.title} desc={PERMISSION_HELP.acceptEdits.desc} />
                  </div>
                ),
              },
              {
                key: 'auto',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name"><RobotOutlined style={{ marginRight: 4 }} />AI tự quyết</span>
                    <span className="model-menu-desc">AI phân loại rủi ro tự động</span>
                    <HelpIcon title={PERMISSION_HELP.auto.title} desc={PERMISSION_HELP.auto.desc} />
                  </div>
                ),
              },
              {
                key: 'plan',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name"><CarryOutOutlined style={{ marginRight: 4 }} />Lập kế hoạch</span>
                    <span className="model-menu-desc">Chỉ lập kế hoạch, không thực thi</span>
                    <HelpIcon title={PERMISSION_HELP.plan.title} desc={PERMISSION_HELP.plan.desc} />
                  </div>
                ),
              },
              { type: 'divider' },
              {
                key: 'bypassPermissions',
                label: (
                  <div className="model-menu-item">
                    <span className="model-menu-name"><WarningOutlined style={{ marginRight: 4, color: '#faad14' }} />Bỏ qua quyền</span>
                    <span className="model-menu-desc">Không hỏi bất kỳ quyền nào</span>
                    <HelpIcon title={PERMISSION_HELP.bypassPermissions.title} desc={PERMISSION_HELP.bypassPermissions.desc} />
                  </div>
                ),
              },
            ],
            onClick: ({ key }) => onPermissionModeChange?.(key),
            selectedKeys: permissionMode ? [permissionMode] : ['default'],
          }}
          trigger={['click']}
          placement="topLeft"
          overlayClassName="toolbar-dropdown"
          styles={{ root: isMobile ? { width: '100vw', left: 0 } : undefined }}
        >
          <button className="toolbar-btn" title="Chế độ quyền">
            <span>
              {permissionMode === 'acceptEdits' ? <><EditOutlined style={{ marginRight: 4 }} />Chấp nhận sửa</>
                : permissionMode === 'auto' ? <><RobotOutlined style={{ marginRight: 4 }} />AI tự quyết</>
                  : permissionMode === 'bypassPermissions' ? <><WarningOutlined style={{ marginRight: 4, color: '#faad14' }} />Bỏ qua quyền</>
                    : permissionMode === 'plan' ? <><CarryOutOutlined style={{ marginRight: 4 }} />Kế hoạch</>
                      : permissionMode === 'dontAsk' ? 'Không hỏi'
                        : <><LockOutlined style={{ marginRight: 4 }} />Mặc định</>}
            </span>
          </button>
        </Dropdown>

        {/* Nút chọn Agent — mở cùng popup như @mention trên mọi thiết bị */}
        <button
          className={`toolbar-btn${agents.length > 0 ? ' toolbar-btn-active' : ''}`}
          title="Giao việc cho Sub-Agent"
          onClick={handleOpenAgentPicker}
        >
          <TeamOutlined />
          <span>Agent{agents.length > 0 ? ` (${agents.length})` : ''}</span>
        </button>

        <Dropdown
          menu={{
            items: (() => {
              if (!latestTodoList) {
                return [
                  {
                    key: '__todo_header__',
                    label: (
                      <div className="todo-menu-header-wrap">
                        <div className="todo-menu-header">
                          <span className="todo-menu-header-title">Todo hiện tại</span>
                        </div>
                      </div>
                    ),
                    disabled: true,
                  },
                  {
                    key: '__todo_empty__',
                    label: <span className="todo-menu-empty">Chưa có danh sách todo nào</span>,
                    disabled: true,
                  },
                ] as MenuItem[];
              }

              const list = latestTodoList;
              const inProgress = list.todos.filter(t => t.status === 'in_progress').length;
              const pending = list.todos.filter(t => (t.status || 'pending') === 'pending').length;
              const completed = list.todos.filter(t => t.status === 'completed').length;
              const ts = new Date(list.timestamp).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

              const header: MenuItem = {
                key: '__todo_header__',
                label: (
                  <div className="todo-menu-header-wrap">
                    <div className="todo-menu-header">
                      <div className="todo-menu-header-main">
                        <span className="todo-menu-header-title">Todo hiện tại</span>
                        <div className="todo-group-meta">
                          <span className="todo-group-time">{ts}</span>
                          <div className="todo-group-badges">
                            {inProgress > 0 && <span className="todo-menu-badge active" title={`Đang ${inProgress}`}><ThunderboltOutlined /> {inProgress}</span>}
                            {pending > 0 && <span className="todo-menu-badge pending" title={`Chờ ${pending}`}><CarryOutOutlined /> {pending}</span>}
                            {completed > 0 && <span className="todo-menu-badge done" title={`Xong ${completed}`}><CheckSquareOutlined /> {completed}</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="todo-group-remove"
                        title="Xóa danh sách todo"
                        onClick={(e) => handleRemoveTodoList(e, list.id)}
                      >
                        <CloseOutlined />
                      </button>
                    </div>
                  </div>
                ),
                disabled: true,
              };

              const labelItem: MenuItem = {
                key: '__todo_label__',
                label: (
                  <div className="todo-label-item">
                    <span className="todo-group-label">{list.label}</span>
                  </div>
                ),
                disabled: true,
              };

              const todoItems: MenuItem[] = list.todos.map((todo, todoIdx) => ({
                key: `todo-${todoIdx}`,
                label: (
                  <div className={`todo-menu-item ${todo.status === 'completed' ? 'done' : ''} ${todo.status === 'in_progress' ? 'active' : ''}`}>
                    <span className="todo-status-icon">
                      {todo.status === 'completed'
                        ? '✓'
                        : todo.status === 'in_progress'
                          ? <LoadingOutlined spin />
                          : '•'}
                    </span>
                    <span className="todo-content">
                      {todo.status === 'in_progress' && todo.activeForm
                        ? todo.activeForm
                        : todo.content || ''}
                    </span>
                  </div>
                ),
                disabled: true,
              }));

              return [header, labelItem, ...todoItems];
            })(),
          }}
          trigger={['click']}
          placement="topLeft"
          overlayClassName="toolbar-dropdown todo-toolbar-dropdown"
          styles={{ root: isMobile ? { width: '100vw', left: 0 } : { minWidth: 360 } }}
        >
          <button
            className={`toolbar-btn${hasIncompleteTodos ? ' toolbar-btn-active' : ''}`}
            title="Danh sách Todo"
            type="button"
          >
            <CheckSquareOutlined />
            <span>Todo</span>
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
