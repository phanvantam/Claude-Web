import { useState, useCallback, useEffect, useRef } from 'react';
import { socketService } from '../services/socket';
import { sessionsApi } from '../services/api';
import type { ChatMessage, ContentBlock } from '../types';

/** Thông tin tool đang chờ permission từ người dùng */
export interface PendingPermission {
  toolName: string;
  input: Record<string, unknown>;
}

/** Một câu hỏi trong AskUserQuestion tool */
export interface AskUserQuestionOption {
  label: string;
  description?: string;
}

export interface AskUserQuestionItem {
  header?: string;
  question: string;
  options?: AskUserQuestionOption[];
  multiSelect?: boolean;
}

/** AskUserQuestion tool đang chờ user trả lời */
export interface PendingAskUser {
  questions: AskUserQuestionItem[];
  metadata?: Record<string, unknown>;
}

interface UseChatReturn {
  messages: ChatMessage[];
  streamingContent: string;
  streamingBlocks: ContentBlock[];
  isConnected: boolean;
  isThinking: boolean;
  status: 'idle' | 'initializing' | 'thinking' | 'tool_use';
  /** Tên tool đang chạy (chỉ có khi status = 'tool_use') */
  activeToolName: string | null;
  /** Timestamp (ms) khi bắt đầu processing — dùng cho elapsed timer */
  processingStartedAt: number | null;
  sessionId: string | null;
  /** Còn messages cũ hơn chưa tải không */
  hasMoreMessages: boolean;
  /** Đang tải messages cũ hơn không */
  isLoadingMore: boolean;
  startSession: (projectId: string, existingSessionId?: string) => void;
  sendMessage: (text: string, displayText?: string) => void;
  abortGeneration: () => void;
  stopSession: () => void;
  clearMessages: () => void;
  /** Chèn tin nhắn hệ thống vào chat — dùng cho slash commands */
  addSystemMessage: (content: string) => void;
  /** Nén context hội thoại — gọi backend compact */
  compactSession: () => void;
  /** Tải thêm messages cũ hơn (infinite scroll) */
  loadOlderMessages: () => Promise<void>;
  /** Model đã lưu cho session này */
  sessionModel?: string;
  /** Effort level đã lưu cho session này */
  sessionEffortLevel?: string;
  /** Cập nhật effort level cho session hiện tại */
  setSessionEffortLevel: (level?: string) => void;
  /** Permission mode đã lưu cho session này */
  sessionPermissionMode?: string;
  /** Cập nhật permission mode cho session hiện tại */
  setSessionPermissionMode: (mode?: string) => void;
  /** Thông tin tool đang chờ permission (null nếu không có) */
  pendingPermission: PendingPermission | null;
  /** Phản hồi permission request: true = allow, false = deny */
  respondPermission: (allowed: boolean) => void;
  /** AskUserQuestion đang chờ user trả lời (null nếu không có) */
  pendingAskUser: PendingAskUser | null;
  /** Phản hồi AskUserQuestion: gửi câu trả lời text */
  respondAskUser: (answer: string) => void;
  /** Đang chuyển phiên (loading overlay) */
  isSwitchingSession: boolean;
  /** Sub-agent đang chạy (null nếu không có) */
  activeSubAgent: { name: string; prompt: string } | null;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'idle' | 'initializing' | 'thinking' | 'tool_use'>('idle');
  /** Tên tool đang thực thi — hiện trên UI thay vì text chung chung */
  const [activeToolName, setActiveToolName] = useState<string | null>(null);
  /** Timestamp (ms) khi bắt đầu processing — dùng để tính elapsed khi reload */
  const [processingStartedAt, setProcessingStartedAt] = useState<number | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [sessionModel, setSessionModel] = useState<string | undefined>();
  const [sessionEffortLevel, setSessionEffortLevelState] = useState<string | undefined>();
  const [sessionPermissionMode, setSessionPermissionModeState] = useState<string | undefined>();
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null);
  const [isSwitchingSession, setIsSwitchingSession] = useState(false);
  /** Sub-agent đang chạy — hiển indicator trong timeline */
  const [activeSubAgent, setActiveSubAgent] = useState<{ name: string; prompt: string } | null>(null);
  const [pendingAskUser, setPendingAskUser] = useState<PendingAskUser | null>(null);
  const streamingRef = useRef('');
  // Giữ ref session ID để reconnect handler luôn có giá trị mới nhất
  const sessionIdRef = useRef<string | null>(null);
  // Session đang chờ kết nối — dùng để filter event khi chuyển phiên
  const pendingSessionIdRef = useRef<string | null>(null);
  // Cursor cho phân trang messages
  const nextCursorRef = useRef<number | null>(null);
  // Track message IDs đã thấy — phân biệt new message vs update (tool result attached)
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  // Safety timer — tự reset status idle nếu chat:status không đến sau khi có message
  const idleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const socket = socketService.connect();

    socket.on('connect', () => {
      console.log('[useChat] Socket connected');
      setIsConnected(true);

      // Tự động re-attach session sau khi reconnect
      const sid = sessionIdRef.current;
      if (sid) {
        console.log(`[useChat] Reconnected — re-attaching session ${sid}`);
        socket.emit('session:attach', { sessionId: sid });
      }
    });

    socket.on('disconnect', () => {
      console.log('[useChat] Socket disconnected');
      setIsConnected(false);
    });

    // Session started hoặc attached — load messages gần nhất qua REST
    socket.on('session:started', async (data: { sessionId: string; state?: { messages: ChatMessage[]; isProcessing: boolean; model?: string; effortLevel?: string; permissionMode?: string; pendingPermission?: PendingPermission; processingStartedAt?: number } }) => {
      // Nếu đang chờ kết nối phiên cụ thể → chỉ chấp nhận đúng phiên đó
      if (pendingSessionIdRef.current && pendingSessionIdRef.current !== data.sessionId) {
        console.log(`[useChat] Ignoring session:started for ${data.sessionId} (pending: ${pendingSessionIdRef.current})`);
        return;
      }
      // Nếu đã có session và event từ session khác → bỏ qua
      if (sessionIdRef.current && sessionIdRef.current !== data.sessionId) {
        console.log(`[useChat] Ignoring session:started for ${data.sessionId} (current: ${sessionIdRef.current})`);
        return;
      }
      // Xóa pending vì đã nhận được session mong muốn
      pendingSessionIdRef.current = null;

      console.log(`[useChat] session:started ID=${data.sessionId}, processing=${data.state?.isProcessing}`);
      setSessionId(data.sessionId);
      sessionIdRef.current = data.sessionId;

      // Snapshot isProcessing TRƯỚC khi fetch — tránh race condition.
      // await getMessages() mất 100-500ms. Trong thời gian đó chat:status idle
      // có thể đã đến và set status='idle'. Không được ghi đè sau khi fetch xong.
      const wasProcessing = data.state?.isProcessing ?? false;

      // Load messages gần nhất qua REST API thay vì nhận toàn bộ qua socket
      try {
        const result = await sessionsApi.getMessages(data.sessionId);
        const uniqueMessages = Array.from(
          new Map(result.messages.map(m => [m.id, m])).values()
        );
        setMessages(uniqueMessages);
        // Seed known IDs — để phân biệt new vs update khi nhận chat:message
        knownMessageIdsRef.current = new Set(uniqueMessages.map(m => m.id));
        setHasMoreMessages(result.hasMore);
        nextCursorRef.current = result.nextCursor;
      } catch (err) {
        console.error('[useChat] Lỗi khi tải messages:', err);
        // Fallback: dùng messages từ socket nếu REST thất bại
        if (data.state?.messages) {
          setMessages(data.state.messages);
        }
        setHasMoreMessages(false);
        nextCursorRef.current = null;
      }

      if (data.state?.model) {
        setSessionModel(data.state.model);
      }

      // Đồng bộ effort level từ server khi load session
      if (data.state?.effortLevel) {
        setSessionEffortLevelState(data.state.effortLevel);
      }

      // Đồng bộ permission mode từ server khi load session
      if (data.state?.permissionMode) {
        setSessionPermissionModeState(data.state.permissionMode);
      }

      // Cập nhật pending permission nếu backend đang chờ xác nhận
      if (data.state?.pendingPermission) {
        setPendingPermission(data.state.pendingPermission);
      } else {
        setPendingPermission(null);
      }

      if (!wasProcessing) {
        // Session idle ngay từ đầu → reset hoàn toàn
        setStatus('idle');
        setProcessingStartedAt(null);
        streamingRef.current = '';
        setStreamingContent('');
        setStreamingBlocks([]);
      } else {
        // Session đang xử lý khi session:started đến.
        // Chỉ set 'thinking' nếu status hiện tại CHƯA là idle —
        // tránh ghi đè chat:status idle đã nhận trong lúc await getMessages().
        setStatus((current) => {
          if (current === 'idle') {
            // idle đã đến trong lúc fetch → giữ nguyên, không ghi đè
            console.log('[useChat] session:started: idle already set during fetch, keeping idle');
            return 'idle';
          }
          return data.state?.pendingPermission ? 'tool_use' : 'thinking';
        });
        // Restore timestamp để timer không reset về 0 khi reload
        setProcessingStartedAt((cur) => cur ?? data.state?.processingStartedAt ?? Date.now());
      }

      // Chuyển phiên hoàn tất — tắt overlay loading + clear safety timeout
      if (switchTimeoutRef.current) {
        clearTimeout(switchTimeoutRef.current);
        switchTimeoutRef.current = null;
      }
      setIsSwitchingSession(false);
    });

    // Message mới (user hoặc assistant) — chỉ xử lý cho session đang xem
    socket.on('chat:message', (data: { sessionId: string; message: ChatMessage }) => {
      if (data.sessionId !== sessionIdRef.current) return;

      // Track message IDs đã thấy để phân biệt new vs update
      const isUpdate = knownMessageIdsRef.current.has(data.message.id);

      if (!isUpdate) {
        knownMessageIdsRef.current.add(data.message.id);
        // Message hoàn toàn mới (finalized) → clear streaming state
        if (data.message.role !== 'user') {
          setStreamingBlocks([]);
          setStreamingContent('');
          streamingRef.current = '';

          // Safety fallback: nếu backend không emit chat:status idle trong 5s,
          // gọi REST API xác nhận trạng thái thực tế trước khi force reset.
          // Tránh false positive khi Claude vẫn đang xử lý tiếp (multi-turn tools).
          if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
          idleTimeoutRef.current = setTimeout(async () => {
            const sid = sessionIdRef.current;
            if (!sid) { idleTimeoutRef.current = null; return; }

            try {
              // Xác nhận qua REST — nguồn sự thật duy nhất
              const { isProcessing } = await sessionsApi.getSessionStatus(sid);
              if (!isProcessing) {
                setStatus((cur) => {
                  if (cur !== 'idle') {
                    console.warn('[useChat] Fallback poll confirmed idle — forcing status=idle');
                    setProcessingStartedAt(null);
                    setActiveSubAgent(null);
                    return 'idle';
                  }
                  return cur;
                });
              } else {
                console.log('[useChat] Fallback poll: backend still processing, keeping status');
              }
            } catch (err) {
              // REST API fail → fallback về force idle (giữ behavior cũ)
              console.warn('[useChat] Fallback poll failed, forcing idle:', err);
              setStatus((cur) => {
                if (cur !== 'idle') {
                  setProcessingStartedAt(null);
                  setActiveSubAgent(null);
                  return 'idle';
                }
                return cur;
              });
            }
            idleTimeoutRef.current = null;
          }, 5000);
        }
      }

      setMessages((prev) => {
        const existingIdx = prev.findIndex(m => m.id === data.message.id);
        if (existingIdx >= 0) {
          // Update existing message (e.g. tokens updated, tool result attached)
          const updated = [...prev];
          updated[existingIdx] = { ...prev[existingIdx], ...data.message };
          return updated;
        }
        return [...prev, data.message];
      });
    });

    // Streaming text — push vào streamingBlocks để hiện real-time
    socket.on('chat:stream', (data: { sessionId: string; content: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      streamingRef.current += data.content;
      setStreamingContent(streamingRef.current);
      // Cập nhật/thêm text block cuối cùng trong streamingBlocks
      setStreamingBlocks(prev => {
        const last = prev[prev.length - 1];
        if (last && last.type === 'text') {
          // Ghi đè text block cuối — tích lũy content
          const updated = [...prev];
          updated[updated.length - 1] = { type: 'text', text: streamingRef.current };
          return updated;
        }
        return [...prev, { type: 'text', text: streamingRef.current }];
      });
    });

    // Streaming tool — push tool_use block vào streamingBlocks để hiện ToolCallCard expandable
    socket.on('chat:stream:tool', (data: { sessionId: string; tool: { id: string; name: string; input: Record<string, unknown> } }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setStreamingBlocks(prev => [...prev, { type: 'tool_use', tool: { ...data.tool } }]);
    });

    socket.on('chat:stream:partial', () => {});

    // Status updates — chỉ xử lý cho session đang xem
    socket.on('chat:status', (data: { sessionId: string; status: 'idle' | 'thinking' | 'tool_use'; toolName?: string; startedAt?: number }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setStatus(data.status);
      // Lưu tên tool đang chạy — reset khi không phải tool_use
      setActiveToolName(data.status === 'tool_use' && data.toolName ? data.toolName : null);
      if (data.status === 'idle') {
        // Nhận được idle thực → hủy safety timer nếu đang có
        if (idleTimeoutRef.current) {
          clearTimeout(idleTimeoutRef.current);
          idleTimeoutRef.current = null;
        }
        setStreamingBlocks([]);
        setStreamingContent('');
        streamingRef.current = '';
        setProcessingStartedAt(null);
        // Reset sub-agent indicator khi turn kết thúc
        setActiveSubAgent(null);
      } else if (data.startedAt) {
        // Cập nhật startedAt từ server (nếu có)
        setProcessingStartedAt(data.startedAt);
      }
    });

    // Errors — chỉ xử lý cho session đang xem
    socket.on('chat:error', (data: { sessionId: string; error: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      console.error(`[useChat] Error: ${data.error}`);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `[Lỗi] ${data.error}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setStatus('idle');
    });

    // Effort level thay đổi — chỉ xử lý cho session đang xem
    socket.on('session:effortChanged', (data: { sessionId: string; effortLevel?: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setSessionEffortLevelState(data.effortLevel);
    });

    // Permission mode thay đổi — chỉ xử lý cho session đang xem
    socket.on('session:permissionModeChanged', (data: { sessionId: string; permissionMode?: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setSessionPermissionModeState(data.permissionMode);
    });

    // Permission request từ backend — tool cần xác nhận
    socket.on('permission:request', (data: { sessionId: string; toolName: string; input: Record<string, unknown> }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setPendingPermission({ toolName: data.toolName, input: data.input });
    });

    // Sub-agent started — Claude gọi tool task() để dispatch sub-agent
    socket.on('subagent:started', (data: { sessionId: string; agentName: string; prompt: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setActiveSubAgent({ name: data.agentName, prompt: data.prompt });
    });

    // Sub-agent ended — kết quả đã nhận, clear indicator
    socket.on('subagent:ended', (data: { sessionId: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setActiveSubAgent(null);
    });

    // AskUserQuestion — Claude muốn hỏi user qua tool tương tác
    socket.on('askUser:question', (data: { sessionId: string; input: Record<string, unknown> }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      const input = data.input || {};
      setPendingAskUser({
        questions: (input.questions as AskUserQuestionItem[]) || [{ question: String(input.question || 'Claude muốn hỏi bạn'), options: input.options as AskUserQuestionOption[] }],
        metadata: input.metadata as Record<string, unknown>,
      });
    });

    // Session compacted — chuyển sang session mới sau khi nén context
    socket.on('session:compacted', (data: { oldSessionId: string; newSessionId: string; state?: any }) => {
      if (data.oldSessionId !== sessionIdRef.current) return;
      console.log(`[useChat] Session compacted: ${data.oldSessionId} → ${data.newSessionId}`);
      setSessionId(data.newSessionId);
      sessionIdRef.current = data.newSessionId;
      if (data.state?.messages) {
        setMessages(data.state.messages);
      }
      setHasMoreMessages(false);
      nextCursorRef.current = null;
      setStatus('idle');
    });

    // Session ended — chỉ xử lý cho session đang xem
    socket.on('session:ended', (data: { sessionId?: string }) => {
      if (data?.sessionId && data.sessionId !== sessionIdRef.current) return;
      console.log('[useChat] Session ended');
      setSessionId(null);
      sessionIdRef.current = null;
      setStatus('idle');
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('session:started');
      socket.off('chat:message');
      socket.off('chat:stream');
      socket.off('chat:stream:tool');
      socket.off('chat:stream:partial');
      socket.off('chat:status');
      socket.off('chat:error');
      socket.off('session:effortChanged');
      socket.off('session:permissionModeChanged');
      socket.off('permission:request');
      socket.off('subagent:started');
      socket.off('subagent:ended');
      socket.off('askUser:question');
      socket.off('session:ended');
      socket.off('session:compacted');
      // Giảm refCount — socket chỉ thực sự disconnect khi hết consumer
      socketService.release();
    };
  }, []);

  // Ref timeout safety — tự tắt overlay nếu session:started không đến
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const startSession = useCallback((projectId: string, existingSessionId?: string) => {
    const socket = socketService.getSocket();
    setMessages([]);
    setStreamingContent('');
    setStreamingBlocks([]);
    streamingRef.current = '';
    knownMessageIdsRef.current = new Set();
    setStatus('idle');
    setSessionId(null);
    sessionIdRef.current = null;
    setHasMoreMessages(false);
    nextCursorRef.current = null;
    // Đánh dấu phiên đang chờ kết nối — filter event từ phiên cũ
    pendingSessionIdRef.current = existingSessionId || null;
    // Bật overlay loading — ngăn bấm liên tiếp và tránh flash nội dung
    setIsSwitchingSession(true);

    // Safety timeout — tự tắt overlay sau 8s nếu session:started không đến
    if (switchTimeoutRef.current) clearTimeout(switchTimeoutRef.current);
    switchTimeoutRef.current = setTimeout(() => {
      setIsSwitchingSession(false);
    }, 8000);

    socket?.emit('session:start', { projectId, sessionId: existingSessionId });
  }, []);

  const sendMessage = useCallback((text: string, displayText?: string) => {
    if (!sessionIdRef.current) return;
    const socket = socketService.getSocket();
    socket?.emit('chat:send', {
      sessionId: sessionIdRef.current,
      message: text,
      ...(displayText ? { displayText } : {}),
    });
  }, []);

  const abortGeneration = useCallback(() => {
    if (!sessionIdRef.current) return;
    const socket = socketService.getSocket();
    socket?.emit('chat:abort', { sessionId: sessionIdRef.current });
    setStatus('idle');
    setStreamingBlocks([]);
    setStreamingContent('');
    streamingRef.current = '';
  }, []);

  const stopSession = useCallback(() => {
    if (!sessionIdRef.current) return;
    const socket = socketService.getSocket();
    socket?.emit('session:stop', { sessionId: sessionIdRef.current });
    setSessionId(null);
    sessionIdRef.current = null;
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setStreamingContent('');
    setStreamingBlocks([]);
    streamingRef.current = '';
  }, []);

  /**
   * Chèn một tin nhắn hệ thống vào cuối danh sách messages.
   * Dùng cho slash commands để hiển thị kết quả mà không cần gọi server.
   */
  const addSystemMessage = useCallback((content: string) => {
    const msg: ChatMessage = {
      id: `sys-${Date.now()}`,
      role: 'system',
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  /**
   * Tải thêm messages cũ hơn — gọi khi user scroll lên đầu.
   * Dùng cursor-based pagination để lấy đúng trang tiếp theo.
   */
  const loadOlderMessages = useCallback(async () => {
    const sid = sessionIdRef.current;
    if (!sid || !hasMoreMessages || isLoadingMore) return;

    setIsLoadingMore(true);
    try {
      const cursor = nextCursorRef.current ?? undefined;
      const result = await sessionsApi.getMessages(sid, cursor);

      setMessages((prev) => {
        // Lọc trùng lặp rồi prepend messages cũ hơn
        const existingIds = new Set(prev.map(m => m.id));
        const newMsgs = result.messages.filter(m => !existingIds.has(m.id));
        return [...newMsgs, ...prev];
      });
      setHasMoreMessages(result.hasMore);
      nextCursorRef.current = result.nextCursor;
    } catch (err) {
      console.error('[useChat] Lỗi khi tải thêm messages:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMoreMessages, isLoadingMore]);

  /**
   * Gửi effort level mới lên server qua socket.
   * Chỉ ảnh hưởng session hiện tại, không thay đổi global config.
   */
  const setSessionEffortLevel = useCallback((level?: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setSessionEffortLevelState(level);
    const socket = socketService.getSocket();
    socket?.emit('session:setEffort', { sessionId: sid, effortLevel: level });
  }, []);

  /**
   * Gửi permission mode mới lên server qua socket.
   * Chỉ ảnh hưởng session hiện tại, không thay đổi global config.
   */
  const setSessionPermissionMode = useCallback((mode?: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setSessionPermissionModeState(mode);
    const socket = socketService.getSocket();
    socket?.emit('session:setPermissionMode', { sessionId: sid, permissionMode: mode });
  }, []);

  /**
   * Phản hồi permission request: allow hoặc deny tool use.
   * Gửi kết quả về backend qua socket, SDK sẽ tiếp tục xử lý.
   */
  /**
   * Yêu cầu backend nén context hội thoại hiện tại.
   * Backend sẽ gọi Claude tóm tắt → tạo session mới → emit session:compacted.
   */
  const compactSession = useCallback(() => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    const socket = socketService.getSocket();
    socket?.emit('chat:compact', { sessionId: sid });
  }, []);

  const respondPermission = useCallback((allowed: boolean) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setPendingPermission(null);
    const socket = socketService.getSocket();
    socket?.emit('permission:respond', { sessionId: sid, allowed });
  }, []);

  /**
   * Phản hồi AskUserQuestion: gửi câu trả lời text về backend.
   * Backend resolve canUseTool → Claude nhận answer và tiếp tục.
   */
  const respondAskUser = useCallback((answer: string) => {
    const sid = sessionIdRef.current;
    if (!sid) return;
    setPendingAskUser(null);
    const socket = socketService.getSocket();
    socket?.emit('askUser:respond', { sessionId: sid, answer });
  }, []);

  return {
    messages,
    streamingContent,
    streamingBlocks,
    isConnected,
    isThinking: status !== 'idle',
    status,
    activeToolName,
    processingStartedAt,
    sessionId,
    hasMoreMessages,
    isLoadingMore,
    startSession,
    sendMessage,
    abortGeneration,
    stopSession,
    clearMessages,
    addSystemMessage,
    compactSession,
    loadOlderMessages,
    sessionModel,
    sessionEffortLevel,
    setSessionEffortLevel,
    sessionPermissionMode,
    setSessionPermissionMode,
    pendingPermission,
    respondPermission,
    pendingAskUser,
    respondAskUser,
    isSwitchingSession,
    activeSubAgent,
  };
}
