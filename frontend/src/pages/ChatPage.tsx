import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, message } from 'antd';
import {
  LoadingOutlined,
} from '@ant-design/icons';
import { projectsApi, configApi, claudeApi, sessionsApi, planApi } from '../services/api';
import { socketService } from '../services/socket';
import { useChat } from '../hooks/useChat';
import ChatWindow from '../components/Chat/ChatWindow';
import InputBox from '../components/Chat/InputBox';
import ChatHeader from '../components/Chat/ChatHeader';
import SubAgentDrawer from '../components/Chat/SubAgentDrawer';
import SubAgentTimelineModal from '../components/Chat/SubAgentTimelineModal';
import SkillDrawer from '../components/Chat/SkillDrawer';
import PlanDrawer from '../components/Chat/PlanDrawer';
import StatsPopoverContent from './ChatPage/StatsPopoverContent';
import { useSlashCommands } from './ChatPage/useSlashCommands';
import type { Project, GlobalConfig, SubAgentInfo } from '../types';

const ChatPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [config, setConfig] = useState<GlobalConfig>({ model: '' });
  const [modelOptions, setModelOptions] = useState<import('../services/api').ModelInfo[]>([]);

  // Sub-Agent UI state
  const [subAgentDrawerOpen, setSubAgentDrawerOpen] = useState(false);
  const [subAgents, setSubAgents] = useState<SubAgentInfo[]>([]);
  const [subAgentsLoading, setSubAgentsLoading] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [timelineModalOpen, setTimelineModalOpen] = useState(false);
  const [skillDrawerOpen, setSkillDrawerOpen] = useState(false);
  const [skillCount, setSkillCount] = useState(0);
  const [planDrawerOpen, setPlanDrawerOpen] = useState(false);
  const [planCount, setPlanCount] = useState(0);
  /** Tên plan đang được thực thi — dùng để cập nhật thành completed khi turn kết thúc */
  const [executingPlanFilename, setExecutingPlanFilename] = useState<string | null>(null);
  
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
    mcpRuntimeStatus,
    refreshMcp,
    todoLists,
    removeTodoList,
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
      console.log(`[ChatPage] Syncing model from session: ${sessionModel}`);
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

  // Fetch số lượng plan files — hiển thị badge trên nút Kế hoạch
  const fetchPlanCount = useCallback(() => {
    if (!project?.id) return;
    planApi.list(project.id).then(data => {
      setPlanCount(data.plans?.length || 0);
    }).catch(() => {});
  }, [project?.id]);

  /** Callback khi PlanModal bắt đầu thực thi */
  const handleExecutionStarted = useCallback((filename: string) => {
    setExecutingPlanFilename(filename);
    fetchPlanCount();
  }, [fetchPlanCount]);

  /**
   * Khi status chuyển từ trạng thái xử lý về idle, nếu đang có plan chạy
   * thì đánh dấu plan đó là completed.
   */
  const prevStatusRef2 = useRef(status);
  useEffect(() => {
    if (prevStatusRef2.current !== 'idle' && status === 'idle' && executingPlanFilename && project?.id) {
      planApi.updateStatus(project.id, executingPlanFilename, 'completed')
        .then(() => fetchPlanCount())
        .catch(() => {})
        .finally(() => setExecutingPlanFilename(null));
    }
    prevStatusRef2.current = status;
  }, [status, executingPlanFilename, project?.id, fetchPlanCount]);

  useEffect(() => {
    if (project?.id) {
      fetchSkillCount();
      fetchPlanCount();
    }
  }, [project?.id, fetchSkillCount, fetchPlanCount]);

  // 3. Tải config mặc định (chỉ chạy khi mount hoặc projectId đổi)
  useEffect(() => {
    configApi.get().then(cfg => {
      setConfig(prev => {
        const finalModel = sessionModel || prev.model || cfg.model;
        console.log(`[ChatPage] Global config loaded. Current: "${prev.model}", Server: "${cfg.model}", Next: "${finalModel}"`);
        return { ...cfg, model: finalModel };
      });
    }).catch(() => {});

    claudeApi.getModels().then(data => {
      setModelOptions(data.models);
      setConfig(prev => {
        const finalModel = sessionModel || prev.model || data.current;
        console.log(`[ChatPage] CLI models loaded. Current: "${prev.model}", CLI: "${data.current}", Next: "${finalModel}"`);
        return { ...prev, model: finalModel };
      });
    }).catch(() => {});
  }, [projectId, sessionModel]); // Thêm sessionModel vào deps để đảm bảo dùng đúng data mới nhất

  // Connect to session only when needed
  useEffect(() => {
    if (!projectId || !project) return;

    const desiredSessionId = querySessionId || null;

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
  }, [projectId, querySessionId, project, startSession, sessionId]);

  // Đồng bộ URL với sessionId thực tế — đảm bảo sidebar highlight đúng
  useEffect(() => {
    if (!projectId || !sessionId) return;

    // Khi vừa tạo session mới từ /chat/:projectId, cho phép đồng bộ URL sang session vừa tạo
    if (!querySessionId) {
      switchingRef.current = false;
    }

    // Đang chuyển sang một session cụ thể khác → tạm thời chưa navigate
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

    // 2. Cập nhật model riêng cho session hiện tại qua socket
    if (sessionId) {
      const socket = socketService.getSocket();
      socket?.emit('session:setModel', { sessionId, model });
    }
  }, [sessionId]);

  /** Xoá toàn bộ cuộc hội thoại hiện tại */
  const handleDeleteSession = useCallback(async () => {
    if (!sessionId || !projectId) return;
    try {
      await sessionsApi.delete(sessionId);
      message.success('Đã xoá cuộc hội thoại');
      navigate(`/chat/${projectId}`, { replace: true });
    } catch {
      message.error('Không thể xoá cuộc hội thoại');
    }
  }, [sessionId, projectId, navigate]);

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

  // Slash commands + @mention agent — xử lý cục bộ trên frontend
  const handleSend = useSlashCommands({
    sessionId,
    projectId,
    configModel: config.model || '',
    sessionStats,
    messagesCount: messages.length,
    effortLabel,
    permissionLabel,
    sendMessage,
    startSession,
    handleModelChange,
    addSystemMessage,
    compactSession,
  });

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

  const todos = todoLists;

  const statsContent = (
    <StatsPopoverContent
      sessionId={sessionId}
      sessionStats={sessionStats}
      modelOptions={modelOptions}
      effortLabel={effortLabel}
      permissionLabel={permissionLabel}
    />
  );

  return (
    <div className="chat-page">
      {/* Chat Header */}
      <ChatHeader
        projectId={projectId}
        project={project}
        skillCount={skillCount}
        onOpenSkillDrawer={() => { setSkillDrawerOpen(true); fetchSkillCount(); }}
        mcpRuntimeStatus={mcpRuntimeStatus}
        onRefreshMcp={refreshMcp}
        subAgentCount={subAgents.length}
        onOpenSubAgentDrawer={handleOpenSubAgentDrawer}
        statsContent={statsContent}
        onClearMessages={clearMessages}
        onDeleteSession={handleDeleteSession}
        planCount={planCount}
        onOpenPlanDrawer={() => { setPlanDrawerOpen(true); fetchPlanCount(); }}
        onNavigateToProject={(id) => navigate(`/project/${id}`)}
      />

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
        onOpenSubAgentTimeline={handleSelectAgent}
        sessionId={sessionId}
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
        todoLists={todos}
        onRemoveTodoList={removeTodoList}
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

      {/* Plan Drawer — danh sách kế hoạch và thực thi thủ công */}
      <PlanDrawer
        open={planDrawerOpen}
        onClose={() => { setPlanDrawerOpen(false); fetchPlanCount(); }}
        projectId={project?.id}
        onExecute={handleSend}
        onExecutionStarted={handleExecutionStarted}
        permissionMode={sessionPermissionMode}
      />
    </div>
  );
};

export default ChatPage;
