import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Popover, Spin, Badge, Tooltip, message } from 'antd';
import {
  FolderOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  RobotOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { projectsApi, configApi, claudeApi, sessionsApi } from '../services/api';
import { useChat } from '../hooks/useChat';
import ChatWindow from '../components/Chat/ChatWindow';
import InputBox from '../components/Chat/InputBox';
import McpStatusPopover from '../components/Chat/McpStatusPopover';
import SubAgentDrawer from '../components/Chat/SubAgentDrawer';
import SubAgentTimelineModal from '../components/Chat/SubAgentTimelineModal';
import SkillDrawer from '../components/Chat/SkillDrawer';
import type { Project, GlobalConfig, SubAgentInfo } from '../types';

const ChatPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [config, setConfig] = useState<GlobalConfig>({ model: '' });

  // Sub-Agent UI state
  const [subAgentDrawerOpen, setSubAgentDrawerOpen] = useState(false);
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([]);
  const [subAgentsLoading, setSubAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [skillDrawerOpen, setSkillDrawerOpen] = useState(false);
  const [skillCount, setSkillCount] = useState(0);
  
  const querySessionId = searchParams.get('sessionId');

  const {
    messages,
    streamingContent,
    streamingBlocks,
    isThinking,
    status,
    sessionId,
    hasMoreMessages,
    isLoadingMore,
    startSession,
    sendMessage,
    abortGeneration,
    clearMessages,
    loadOlderMessages,
    sessionModel,
    sessionEffortLevel,
    setSessionEffortLevel,
    sessionPermissionMode,
    setSessionPermissionMode,
    pendingPermission,
    respondPermission,
    activeToolName,
    processingStartedAt,
    addSystemMessage,
    compactSession,
    isSwitchingSession,
    activeSubAgent,
    pendingAskUser,
    respondAskUser,
  } = useChat();

  const lastStartedRef = React.useRef<string | null>(null);
  // Cờ đánh dấu đang chuyển phiên — ngăn effect đồng bộ URL chạy với sessionId cũ
  const switchingRef = useRef(false);

  // Lưu mốc xem session vào localStorage — giúp Sidebar biết session nào đã đọc
  useEffect(() => {
    if (!sessionId) return;

    // Đánh dấu ngay khi mở
    localStorage.setItem(`sessionViewed:${sessionId}`, String(Date.now()));

    // Cập nhật liên tục mỗi 2 giây khi đang xem
    const interval = setInterval(() => {
      localStorage.setItem(`sessionViewed:${sessionId}`, String(Date.now()));
    }, 2000);

    return () => {
      clearInterval(interval);
      // Đánh dấu lần cuối khi rời đi
      localStorage.setItem(`sessionViewed:${sessionId}`, String(Date.now()));
    };
  }, [sessionId]);

  // 1. Đồng bộ model của session vào config UI khi sessionModel thay đổi
  useEffect(() => {
    if (sessionModel) {
      console.log(`[ChatPage] ✅ Syncing model from session: ${sessionModel}`);
      setConfig(prev => ({ ...prev, model: sessionModel }));
    }
  }, [sessionModel]);

  // 2. Tải project info khi projectId thay đổi
  useEffect(() => {
    if (projectId) {
      projectsApi.getById(projectId).then(setProject).catch(() => {
        message.error('Không tìm thấy dự án');
        navigate('/');
      });
    }
  }, [projectId, navigate]);

  // Fetch số lượng custom skills — đồng bộ với SkillDrawer (cùng API listCustomCommands)
  const fetchSkillCount = useCallback(() => {
    Promise.all([
      claudeApi.listCustomCommands('global'),
      project?.id ? claudeApi.listCustomCommands('project', project.id) : Promise.resolve([]),
    ]).then(([global, proj]) => {
      setSkillCount(global.length + proj.length);
    }).catch(() => {});
  }, [project?.id]);

  useEffect(() => {
    if (project?.id) fetchSkillCount();
  }, [project?.id, fetchSkillCount]);

  // 3. Tải config mặc định (chỉ chạy khi mount hoặc projectId đổi)
  useEffect(() => {
    configApi.get().then(cfg => {
      setConfig(prev => {
        const finalModel = sessionModel || prev.model || cfg.model;
        console.log(`[ChatPage] ⚙️ Global config loaded. Current: "${prev.model}", Server: "${cfg.model}", Next: "${finalModel}"`);
        return { ...cfg, model: finalModel };
      });
    }).catch(() => {});

    claudeApi.getModels().then(data => {
      setConfig(prev => {
        const finalModel = sessionModel || prev.model || data.current;
        console.log(`[ChatPage] 🤖 CLI models loaded. Current: "${prev.model}", CLI: "${data.current}", Next: "${finalModel}"`);
        return { ...prev, model: finalModel };
      });
    }).catch(() => {});
  }, [projectId, sessionModel]); // Thêm sessionModel vào deps để đảm bảo dùng đúng data mới nhất

  // Connect to session only when needed
  useEffect(() => {
    if (!projectId || !project) return;

    const isNew = searchParams.get('new') === 'true';
    const desiredSessionId = isNew ? null : (querySessionId || project.activeSessionId || null);
    
    if (sessionId === desiredSessionId && sessionId !== null) {
      switchingRef.current = false;
      return; 
    }

    const startKey = desiredSessionId || 'new';
    if (lastStartedRef.current !== startKey) {
      console.log(`[ChatPage] Connecting: desiredSessionId=${desiredSessionId}, currentSessionId=${sessionId}`);
      lastStartedRef.current = startKey;
      // Đánh dấu đang chuyển phiên — ngăn effect URL redirect về phiên cũ
      switchingRef.current = true;
      startSession(project.id, desiredSessionId || undefined);
    }
  }, [projectId, querySessionId, project, startSession, sessionId, searchParams]);

  // Đồng bộ URL với sessionId thực tế — đảm bảo sidebar highlight đúng
  // Chỉ chạy khi KHÔNG đang chuyển phiên, tránh redirect ngược về phiên cũ
  useEffect(() => {
    if (!projectId || !sessionId) return;
    // Đang chuyển phiên → không navigate, để tránh redirect về phiên cũ
    if (switchingRef.current) return;
    if (querySessionId !== sessionId) {
      navigate(`/chat/${projectId}?sessionId=${sessionId}`, { replace: true });
    }
  }, [projectId, sessionId, querySessionId, navigate]);

  /** Đổi model — lưu vào config backend và lưu riêng cho session hiện tại */
  const handleModelChange = useCallback((model: string) => {
    setConfig(prev => ({ ...prev, model }));
    
    // 1. Cập nhật global config
    configApi.update({ model }).catch(() => {
      message.error('Lỗi khi đổi model mặc định');
    });

    // 2. Cập nhật model riêng cho session hiện tại (hội thoại)
    if (sessionId) {
      sessionsApi.update(sessionId, { model } as any).catch(() => {
        console.error('[ChatPage] Failed to save model for session');
      });
    }
  }, [sessionId]);

  const sessionStats = useMemo(() => {
    let inputTokens = 0;
    let outputTokens = 0;
    let cost = 0;
    let turns = 0;
    let model = config.model || '';

    for (const msg of messages) {
      if (msg.role === 'assistant') {
        if (msg.tokens) {
          inputTokens += msg.tokens.input || 0;
          outputTokens += msg.tokens.output || 0;
        }
        if (msg.model) model = msg.model;
        turns++;
      }
      if (msg.cost) cost += msg.cost;
    }

    return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, cost, turns, model };
  }, [messages, config.model]);

  /** Chuyển effort level key sang nhãn tiếng Việt */
  const effortLabelMap: Record<string, string> = {
    low: 'Thấp',
    medium: 'Trung bình',
    high: 'Cao',
  };
  const effortLabel = sessionEffortLevel ? (effortLabelMap[sessionEffortLevel] || sessionEffortLevel) : 'Trung bình';

  /** Chuyển permission mode key sang nhãn tiếng Việt */
  const permissionLabelMap: Record<string, string> = {
    default: 'Mặc định',
    acceptEdits: 'Chấp nhận sửa',
    bypassPermissions: 'Bỏ qua quyền',
    plan: 'Lập kế hoạch',
    dontAsk: 'Không hỏi',
  };
  const permissionLabel = sessionPermissionMode ? (permissionLabelMap[sessionPermissionMode] || sessionPermissionMode) : 'Mặc định';

  /**
   * Xử lý gửi tin nhắn hoặc thực thi slash command.
   * Các lệnh bắt đầu bằng '/' được chặn lại và xử lý cục bộ trên frontend,
   * không gửi qua SDK để tránh Claude trả lời sống sượng.
   */
  const handleSend = useCallback((text: string) => {
    if (!sessionId) {
      message.warning('Hãy bắt đầu phiên chat trước');
      return;
    }

    const trimmed = text.trim();

    // Không phải slash command → kiểm tra @mention agent rồi gửi
    if (!trimmed.startsWith('/')) {
      // Transform @agent-name thành SDK directive
      // Case 1: "@agent-name task text" → gọi agent với task cụ thể
      const mentionWithTask = trimmed.match(/^@([a-z0-9_-]+)\s+([\s\S]+)/i);
      if (mentionWithTask) {
        const [, agentName, task] = mentionWithTask;
        sendMessage(`Use the "${agentName}" subagent to: ${task}`);
        return;
      }
      // Case 2: "@agent-name" không có task → gọi agent với context hiện tại
      const mentionOnly = trimmed.match(/^@([a-z0-9_-]+)$/i);
      if (mentionOnly) {
        const agentName = mentionOnly[1];
        sendMessage(`Use the "${agentName}" subagent to: assist with the current context`);
        return;
      }
      sendMessage(trimmed);
      return;
    }

    // Tách lệnh và tham số
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/clear': {
        // Tạo session mới hoàn toàn
        if (projectId) {
          startSession(projectId);
          message.success('Bắt đầu cuộc hội thoại mới');
        }
        break;
      }

      case '/model': {
        if (args.length > 0) {
          handleModelChange(args[0]);
          addSystemMessage(`### Thay đổi Model\n\nĐã chuyển sang model: **${args[0]}**`);
        } else {
          addSystemMessage(`### Thông tin Model\n\n**Model hiện tại:** \`${config.model || '—'}\``);
        }
        break;
      }

      case '/cost': {
        const rows = [
          `| Thông tin | Giá trị |`,
          `| :--- | :--- |`,
          `| **Model** | \`${sessionStats.model || '—'}\` |`,
          `| **Tokens nhận** | ${sessionStats.inputTokens.toLocaleString('vi-VN')} |`,
          `| **Tokens gửi** | ${sessionStats.outputTokens.toLocaleString('vi-VN')} |`,
          `| **Tổng tokens** | **${sessionStats.totalTokens.toLocaleString('vi-VN')}** |`,
          `| **Chi phí** | **$${sessionStats.cost.toFixed(4)}** |`,
          `| **Lượt hỏi** | ${sessionStats.turns} |`,
        ];
        addSystemMessage(`### Thống kê phiên hiện tại\n\n${rows.join('\n')}`);
        break;
      }

      case '/status': {
        const statusRows = [
          `| Thuộc tính | Trạng thái |`,
          `| :--- | :--- |`,
          `| **Session ID** | \`${sessionId}\` |`,
          `| **Model** | \`${config.model || '—'}\` |`,
          `| **Nỗ lực** | \`${effortLabel}\` |`,
          `| **Quyền** | \`${permissionLabel}\` |`,
          `| **Tin nhắn** | ${messages.length} |`,
        ];
        addSystemMessage(`### Trạng thái phiên\n\n${statusRows.join('\n')}`);
        break;
      }

      case '/help': {
        const helpLines = [
          `### Danh sách lệnh khả dụng`,
          ``,
          `- \`/clear\` — **Làm mới**: Xóa lịch sử và bắt đầu hội thoại mới.`,
          `- \`/cost\` — **Chi phí**: Xem thống kê token và chi phí phiên này.`,
          `- \`/status\` — **Trạng thái**: Kiểm tra cấu hình phiên hiện tại.`,
          `- \`/model [tên]\` — **Model**: Xem hoặc chuyển đổi AI model.`,
          `- \`/compact\` — **Nén**: Tóm tắt ngữ cảnh (Claude sẽ thực hiện).`,
          `- \`/help\` — **Trợ giúp**: Hiển thị danh sách này.`,
          ``,
          `*Mẹo: Bạn có thể @mention một agent (vd: \`@coder\`) để giao việc chuyên biệt.*`,
        ];
        addSystemMessage(helpLines.join('\n'));
        break;
      }

      case '/compact': {
        addSystemMessage(`**Đang nén context...** Claude sẽ tóm tắt nội dung và khởi tạo phiên mới để tối ưu bộ nhớ.`);
        compactSession();
        break;
      }

      default: {
        // Custom/plugin slash command — forward cho Claude SDK xử lý.
        // Claude CLI hỗ trợ custom commands natively (từ ~/.claude/commands/ hoặc plugins).
        sendMessage(trimmed);
        break;
      }
    }
  }, [sessionId, projectId, config.model, sessionStats, messages.length, effortLabel, permissionLabel, sendMessage, startSession, handleModelChange, addSystemMessage, compactSession]);

  /**
   * Fetch danh sách sub-agents cho session hiện tại.
   * Gọi khi mở drawer hoặc khi session kết thúc 1 turn (status = idle).
   */
  const fetchSubAgents = useCallback(async () => {
    if (!sessionId) {
      setSubAgents([]);
      return;
    }
    setSubAgentsLoading(true);
    try {
      const agents = await sessionsApi.listSubAgents(sessionId);
      setSubAgents(agents);
    } catch (err) {
      console.error('[ChatPage] Lỗi tải sub-agents:', err);
    } finally {
      setSubAgentsLoading(false);
    }
  }, [sessionId]);

  // Fetch sub-agents ngay khi sessionId có giá trị (load page, chuyển session)
  useEffect(() => {
    if (sessionId) fetchSubAgents();
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-fetch sub-agents khi status chuyển về idle (turn kết thúc)
  // Delay 2s vì sub-agent files có thể chưa ghi xong filesystem lúc status = idle
  const prevStatusRef = useRef(status);
  useEffect(() => {
    if (prevStatusRef.current !== 'idle' && status === 'idle' && sessionId) {
      const timer = setTimeout(() => fetchSubAgents(), 2000);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = status;
  }, [status, sessionId, fetchSubAgents]);


  // Fetch khi mở drawer thủ công
  const handleOpenSubAgentDrawer = useCallback(() => {
    setSubAgentDrawerOpen(true);
    fetchSubAgents();
  }, [fetchSubAgents]);

  // Callback khi user click vào agent trong drawer → mở modal timeline
  const handleSelectAgent = useCallback((agentId: string) => {
    setSelectedAgentId(agentId);
    setTimelineModalOpen(true);
  }, []);

  // Tìm info agent đang xem để hiện title trong modal
  const selectedAgentInfo = useMemo(() => {
    if (!selectedAgentId) return null;
    return subAgents.find(a => a.agentId === selectedAgentId) || null;
  }, [selectedAgentId, subAgents]);

  const statsContent = (
    <div style={{ fontSize: 12, minWidth: 200, color: 'rgba(255,255,255,0.85)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Model</span>
        <span style={{ fontFamily: 'monospace' }}>{sessionStats.model || '—'}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Nỗ lực</span>
        <span style={{ fontFamily: 'monospace' }}>{effortLabel}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Quyền</span>
        <span style={{ fontFamily: 'monospace' }}>{permissionLabel}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Tokens nhận</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{sessionStats.inputTokens.toLocaleString('vi-VN')}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Tokens gửi</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{sessionStats.outputTokens.toLocaleString('vi-VN')}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Tổng tokens</span>
        <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{sessionStats.totalTokens.toLocaleString('vi-VN')}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Chi phí</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>${sessionStats.cost.toFixed(4)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>Số lượt</span>
        <span>{sessionStats.turns}</span>
      </div>
    </div>
  );

  return (
    <div className="chat-page">
      {/* Chat Header */}
      <div className="chat-header">
        <div className="chat-header-left" onClick={() => navigate('/')}>
          <FolderOutlined style={{ color: 'var(--accent)', fontSize: 14, flexShrink: 0 }} />
          <span className="chat-header-path" title={project?.path}>
            {project?.path || 'Loading...'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Nút Skills — quản lý custom slash commands */}
          <Badge count={skillCount} size="small" offset={[-4, 4]} style={{ backgroundColor: '#e17055' }}>
            <Tooltip title="Skills">
              <Button
                type="text"
                icon={<ThunderboltOutlined />}
                onClick={() => { setSkillDrawerOpen(true); fetchSkillCount(); }}
                style={{ color: skillCount > 0 ? '#e17055' : 'rgba(255,255,255,0.4)' }}
                size="small"
              />
            </Tooltip>
          </Badge>
          <McpStatusPopover projectId={project?.id} />
          {/* Nút Sub Agents — badge hiện số lượng agent đã chạy */}
          <Badge count={subAgents.length} size="small" offset={[-4, 4]} style={{ backgroundColor: 'var(--accent)' }}>
            <Button
              type="text"
              icon={<RobotOutlined />}
              onClick={handleOpenSubAgentDrawer}
              style={{ color: subAgents.length > 0 ? 'var(--accent)' : 'rgba(255,255,255,0.4)' }}
              size="small"
              title="Sub Agents"
            />
          </Badge>
          <Popover content={statsContent} trigger="click" placement="bottomRight">
            <Button
              type="text"
              icon={<InfoCircleOutlined />}
              style={{ color: 'rgba(255,255,255,0.4)' }}
              size="small"
            />
          </Popover>
          <Button
            type="text"
            icon={<DeleteOutlined />}
            onClick={clearMessages}
            style={{ color: 'rgba(255,255,255,0.4)' }}
            title="Xóa tin nhắn"
            size="small"
          />
        </div>
      </div>

      {/* Chat Messages */}
      <ChatWindow
        messages={messages}
        streamingContent={streamingContent}
        streamingBlocks={streamingBlocks}
        isThinking={isThinking}
        status={status}
        hasMoreMessages={hasMoreMessages}
        isLoadingMore={isLoadingMore}
        onLoadMore={loadOlderMessages}
        pendingPermission={pendingPermission}
        activeToolName={activeToolName}
        processingStartedAt={processingStartedAt}
        activeSubAgent={activeSubAgent}
      />

      {/* Input Box */}
      <InputBox
        onSend={handleSend}
        disabled={!sessionId}
        isThinking={isThinking}
        currentModel={config.model || 'sonnet'}
        onModelChange={handleModelChange}
        onAbort={abortGeneration}
        effortLevel={sessionEffortLevel}
        onEffortChange={setSessionEffortLevel}
        permissionMode={sessionPermissionMode}
        onPermissionModeChange={setSessionPermissionMode}
        pendingPermission={pendingPermission}
        onRespondPermission={respondPermission}
        projectId={project?.id}
        pendingAskUser={pendingAskUser}
        onRespondAskUser={respondAskUser}
      />
      {/* Loading overlay khi chuyển phiên — backdrop blur + chặn click */}
      {isSwitchingSession && (
        <div className="session-switch-overlay">
          <Spin indicator={<LoadingOutlined style={{ fontSize: 28, color: 'var(--accent)' }} />} />
        </div>
      )}

      {/* Sub-Agent Drawer — danh sách agents đã chạy */}
      <SubAgentDrawer
        open={subAgentDrawerOpen}
        onClose={() => setSubAgentDrawerOpen(false)}
        agents={subAgents}
        onSelectAgent={handleSelectAgent}
        loading={subAgentsLoading}
        onRefresh={fetchSubAgents}
      />

      {/* Sub-Agent Timeline Modal — chi tiết hoạt động agent */}
      <SubAgentTimelineModal
        open={timelineModalOpen}
        onClose={() => { setTimelineModalOpen(false); setSelectedAgentId(null); }}
        sessionId={sessionId}
        agentId={selectedAgentId}
        agentInfo={selectedAgentInfo}
      />

      {/* Skill Drawer — quản lý custom slash commands */}
      <SkillDrawer
        open={skillDrawerOpen}
        onClose={() => { setSkillDrawerOpen(false); fetchSkillCount(); }}
        projectId={project?.id}
      />
    </div>
  );
};

export default ChatPage;
