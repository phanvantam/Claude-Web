import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Popover, Spin, message } from 'antd';
import {
  FolderOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { projectsApi, configApi, claudeApi, sessionsApi } from '../services/api';
import { useChat } from '../hooks/useChat';
import ChatWindow from '../components/Chat/ChatWindow';
import InputBox from '../components/Chat/InputBox';
import McpStatusPopover from '../components/Chat/McpStatusPopover';
import type { Project, GlobalConfig } from '../types';

const ChatPage: React.FC = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [config, setConfig] = useState<GlobalConfig>({ model: '' });
  
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

    // Không phải slash command → gửi bình thường
    if (!trimmed.startsWith('/')) {
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
          // /model <name> → đổi model
          handleModelChange(args[0]);
          addSystemMessage(`✅ Đã chuyển sang model: **${args[0]}**`);
        } else {
          // /model → hiển model hiện tại
          addSystemMessage(`**Model hiện tại:** ${config.model || '—'}`);
        }
        break;
      }

      case '/cost': {
        const lines = [
          `**Thống kê phiên hiện tại**`,
          `- Model: ${sessionStats.model || '—'}`,
          `- Tokens nhận: ${sessionStats.inputTokens.toLocaleString('vi-VN')}`,
          `- Tokens gửi: ${sessionStats.outputTokens.toLocaleString('vi-VN')}`,
          `- Tổng tokens: **${sessionStats.totalTokens.toLocaleString('vi-VN')}**`,
          `- Chi phí: **$${sessionStats.cost.toFixed(4)}**`,
          `- Số lượt hỏi: ${sessionStats.turns}`,
        ];
        addSystemMessage(lines.join('\n'));
        break;
      }

      case '/status': {
        const statusLines = [
          `**Trạng thái phiên**`,
          `- Session ID: \`${sessionId}\``,
          `- Model: ${config.model || '—'}`,
          `- Nỗ lực: ${effortLabel}`,
          `- Quyền: ${permissionLabel}`,
          `- Tin nhắn: ${messages.length}`,
        ];
        addSystemMessage(statusLines.join('\n'));
        break;
      }

      case '/help': {
        const helpLines = [
          `**Lệnh khả dụng**`,
          `- \`/clear\` — Tạo cuộc hội thoại mới (xoá lịch sử)`,
          `- \`/compact\` — Nén ngữ cảnh (⚠️ chưa hỗ trợ)`,
          `- \`/cost\` — Hiển thị chi phí & token phiên hiện tại`,
          `- \`/help\` — Danh sách lệnh này`,
          `- \`/model [tên]\` — Xem hoặc đổi model`,
          `- \`/status\` — Trạng thái phiên hiện tại`,
        ];
        addSystemMessage(helpLines.join('\n'));
        break;
      }

      case '/compact': {
        addSystemMessage(`⏳ Đang nén context hội thoại... Claude sẽ tóm tắt và tạo phiên mới.`);
        compactSession();
        break;
      }

      default: {
        addSystemMessage(`❌ Lệnh \`${cmd}\` không tồn tại. Gõ \`/help\` để xem danh sách lệnh.`);
        break;
      }
    }
  }, [sessionId, projectId, config.model, sessionStats, messages.length, effortLabel, permissionLabel, sendMessage, startSession, handleModelChange, addSystemMessage, compactSession]);

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
          <McpStatusPopover projectId={project?.id} />
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
      />
      {/* Loading overlay khi chuyển phiên — backdrop blur + chặn click */}
      {isSwitchingSession && (
        <div className="session-switch-overlay">
          <Spin indicator={<LoadingOutlined style={{ fontSize: 28, color: 'var(--accent)' }} />} />
        </div>
      )}
    </div>
  );
};

export default ChatPage;
