import { useState, useCallback, useRef } from 'react';
import { socketService } from '../services/socket';
import { sessionsApi } from '../services/api';
import { useChatSocketListeners } from './useChatSocketListeners';
import type { ChatMessage, ContentBlock, TodoList } from '../types';

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

/** Runtime status của 1 MCP server — lấy từ SDK init event */
export interface McpRuntimeServer {
  name: string;
  status: 'connected' | 'failed' | 'pending' | 'unknown';
  serverInfo?: { name?: string; version?: string } | null;
  tools: string[];
  error?: string | null;
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
  /** Sub-agent đang chạy (null nếu không có). activities: danh sách tool đang/đã chạy nội bộ */
  activeSubAgent: {
    name: string;
    prompt: string;
    lastHeartbeat?: number;
    activities?: Array<{ toolName: string; inputSummary?: string; timestamp: number }>;
    currentToolName?: string;
  } | null;
  /** Runtime status của MCP servers — lấy từ SDK init event mỗi lần gửi message */
  mcpRuntimeStatus: McpRuntimeServer[];
  /** Làm mới MCP — gửi lại config cho session đang chạy */
  refreshMcp: () => void;
  /** Tất cả todo lists trong session (append-only, không auto-clear) */
  todoLists: TodoList[];
  /** Xóa một todo list khỏi UI theo id */
  removeTodoList: (listId: string) => void;
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
  const [activeSubAgent, setActiveSubAgent] = useState<{
    name: string;
    prompt: string;
    lastHeartbeat?: number;
    activities?: Array<{ toolName: string; inputSummary?: string; timestamp: number }>;
    currentToolName?: string;
  } | null>(null);
  const [pendingAskUser, setPendingAskUser] = useState<PendingAskUser | null>(null);
  /** Runtime MCP status — cập nhật mỗi lần SDK gửi init event */
  const [mcpRuntimeStatus, setMcpRuntimeStatus] = useState<McpRuntimeServer[]>([]);
  const [todoLists, setTodoLists] = useState<TodoList[]>([]);
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
  // Track session đang restore để phân biệt idle ban đầu với idle event thật sự đến trong lúc attach
  const restoringSessionIdRef = useRef<string | null>(null);
  const idleDuringRestoreRef = useRef(false);
  // Track thời điểm user bấm Stop để bỏ qua các stream event đến trễ từ backend
  const localAbortAtRef = useRef<number | null>(null);

  // Ref timeout safety — tự tắt overlay nếu session:started không đến
  const switchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useChatSocketListeners({
    setIsConnected,
    setMessages,
    setStreamingContent,
    setStreamingBlocks,
    setStatus,
    setActiveToolName,
    setProcessingStartedAt,
    setSessionId,
    setHasMoreMessages,
    setSessionModel,
    setSessionEffortLevelState,
    setSessionPermissionModeState,
    setPendingPermission,
    setIsSwitchingSession,
    setActiveSubAgent,
    setPendingAskUser,
    setMcpRuntimeStatus,
    setTodoLists,
    streamingRef,
    sessionIdRef,
    pendingSessionIdRef,
    nextCursorRef,
    knownMessageIdsRef,
    idleTimeoutRef,
    restoringSessionIdRef,
    idleDuringRestoreRef,
    localAbortAtRef,
    switchTimeoutRef,
  });

  const startSession = useCallback((projectId: string, existingSessionId?: string) => {
    const socket = socketService.getSocket();
    localAbortAtRef.current = null;
    setMessages([]);
    setStreamingContent('');
    setStreamingBlocks([]);
    streamingRef.current = '';
    knownMessageIdsRef.current = new Set();
    setStatus('idle');
    setSessionId(null);
    sessionIdRef.current = null;
    setSessionEffortLevelState(undefined);
    setSessionPermissionModeState(undefined);
    setSessionModel(undefined);
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
    localAbortAtRef.current = null;
    const socket = socketService.getSocket();
    socket?.emit('chat:send', {
      sessionId: sessionIdRef.current,
      message: text,
      ...(displayText ? { displayText } : {}),
    });
  }, []);

  const abortGeneration = useCallback(() => {
    if (!sessionIdRef.current) return;
    localAbortAtRef.current = Date.now();
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

  // Làm mới MCP — gửi socket event để backend reload config cho session hiện tại
  const refreshMcp = useCallback(() => {
    const socket = socketService.getSocket();
    if (!socket || !sessionIdRef.current) return;
    // Reset status về pending trước khi gửi
    setMcpRuntimeStatus(prev => prev.map(s => ({ ...s, status: 'pending' as const })));
    socket.emit('mcp:refresh', { sessionId: sessionIdRef.current });
  }, []);

  /**
   * Xóa một todo list khỏi danh sách theo ID.
   * Dùng cho nút xóa trong dropdown.
   * Lưu ID đã xóa vào localStorage để persist qua reload.
   */
  const removeTodoList = useCallback((listId: string) => {
    setTodoLists(prev => prev.filter(list => list.id !== listId));

    // Lưu vào localStorage để persist qua reload
    const sid = sessionIdRef.current;
    if (!sid) return;

    const storageKey = `dismissedTodos:${sid}`;
    const existing = localStorage.getItem(storageKey);
    const dismissed = existing ? JSON.parse(existing) : [];
    if (!dismissed.includes(listId)) {
      dismissed.push(listId);
      localStorage.setItem(storageKey, JSON.stringify(dismissed));
    }
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
    mcpRuntimeStatus,
    refreshMcp,
    todoLists,
    removeTodoList,
  };
}
