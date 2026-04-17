/**
 * Đăng ký các socket event liên quan đến quản lý session:
 * session:started, session:ended, session:compacted, session:effortChanged,
 * session:permissionModeChanged, permission:*, subagent:*, mcp:*, askUser:*
 *
 * Tách từ useChatSocketListeners.ts — nhóm handlers theo chức năng.
 */

import type { Socket } from 'socket.io-client';
import { sessionsApi } from '../../services/api';
import type { ChatMessage } from '../../types';
import type {
  AskUserQuestionItem,
  AskUserQuestionOption,
  McpRuntimeServer,
} from '../useChat';
import type { SocketHandlerDeps, SessionStartedState } from './types';

/**
 * Đăng ký session + control handlers. Trả về danh sách event names
 * để caller gọi socket.off() khi cleanup.
 */
export function registerSessionHandlers(socket: Socket, deps: SocketHandlerDeps): string[] {
  const {
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
  } = deps;

  const rebuildTodoListsFromMessages = (messages: ChatMessage[], sessionId?: string) => {
    const dismissed = new Set<string>(
      sessionId
        ? JSON.parse(localStorage.getItem(`dismissedTodos:${sessionId}`) || '[]')
        : []
    );

    let latest: import('../../types').TodoList | null = null;

    for (const msg of messages) {
      if (msg.role !== 'assistant' || !msg.blocks) continue;
      for (const block of msg.blocks) {
        if (block.type !== 'tool_use' || block.tool?.name !== 'TodoWrite') continue;
        const listId = `${msg.id}-${block.tool.id}`;
        if (dismissed.has(listId)) continue;
        const todos = ((block.tool.input?.todos || block.tool.input?.items || []) as import('../../types').TodoItem[]);
        if (todos.length === 0) continue;
        const first = todos[0]?.content || todos[0]?.activeForm || '';
        const label = !first
          ? 'Task List'
          : first.length <= 40
            ? first
            : `${first.slice(0, Math.max(first.slice(0, 40).lastIndexOf(' '), 20)).trim()}...`;
        latest = {
          id: listId,
          label,
          todos,
          timestamp: msg.timestamp,
          messageId: msg.id,
          toolCallId: block.tool.id,
        };
      }
    }

    return latest ? [latest] : [];
  };

  // ─── Session lifecycle ──────────────────────────────────────────────
  socket.on('session:started', async (data: { sessionId: string; state?: SessionStartedState }) => {
    if (pendingSessionIdRef.current && pendingSessionIdRef.current !== data.sessionId) {
      return;
    }
    if (sessionIdRef.current && sessionIdRef.current !== data.sessionId) {
      return;
    }
    pendingSessionIdRef.current = null;

    setSessionId(data.sessionId);
    sessionIdRef.current = data.sessionId;

    restoringSessionIdRef.current = data.sessionId;
    idleDuringRestoreRef.current = false;

    const wasProcessing = data.state?.isProcessing ?? false;

    try {
      const result = await sessionsApi.getMessages(data.sessionId);
      const uniqueMessages = Array.from(new Map(result.messages.map(m => [m.id, m])).values());
      setMessages(uniqueMessages);
      knownMessageIdsRef.current = new Set(uniqueMessages.map(m => m.id));
      setHasMoreMessages(result.hasMore);
      nextCursorRef.current = result.nextCursor;

      // Reconstruct todo lists from historical messages — append-only, no auto-clear
      const reconstructed = rebuildTodoListsFromMessages(uniqueMessages, data.sessionId);
      setTodoLists(reconstructed);
    } catch {
      if (data.state?.messages) {
        setMessages(data.state.messages);
        const reconstructed = rebuildTodoListsFromMessages(data.state.messages, data.sessionId);
        setTodoLists(reconstructed);
      }
      setHasMoreMessages(false);
      nextCursorRef.current = null;
    }

    if (data.state?.model) setSessionModel(data.state.model);
    if (data.state?.effortLevel) setSessionEffortLevelState(data.state.effortLevel);
    if (data.state?.permissionMode) setSessionPermissionModeState(data.state.permissionMode);

    // Chỉ restore AskUser khi session đang "chạy dở" (isProcessing=true).
    // Nếu wasProcessing=false → session đã kết thúc bình thường, không có AskUser nào đang chờ.
    const restoredPendingPermission = data.state?.pendingPermission;
    const isRestoredAskUser = wasProcessing && restoredPendingPermission?.toolName === 'AskUserQuestion';

    if (isRestoredAskUser) {
      const input = restoredPendingPermission?.input || {};
      setPendingPermission(null);
      setPendingAskUser({
        questions: (input.questions as AskUserQuestionItem[]) || [{
          question: String(input.question || 'Claude muốn hỏi bạn'),
          options: input.options as AskUserQuestionOption[],
          multiSelect: input.multiSelect === true,
          header: typeof input.header === 'string' ? input.header : undefined,
        }],
        metadata: input.metadata as Record<string, unknown>,
      });
    } else {
      if (restoredPendingPermission) setPendingPermission(restoredPendingPermission);
      else setPendingPermission(null);

      if (data.state?.pendingAskUser && wasProcessing) setPendingAskUser(data.state.pendingAskUser);
      else setPendingAskUser(null);
    }

    setActiveToolName(data.state?.activeToolName || null);
    setActiveSubAgent(data.state?.activeSubAgent || null);

    if (data.state?.partialAssistantBlocks?.length) {
      setStreamingBlocks(data.state.partialAssistantBlocks);
      setStreamingContent(data.state.partialAssistantContent || '');
      streamingRef.current = data.state.partialAssistantContent || '';
    }

    if (!wasProcessing) {
      localAbortAtRef.current = null;
      setStatus('idle');
      setProcessingStartedAt(null);
      setActiveToolName(null);
      setActiveSubAgent(null);
      streamingRef.current = '';
      setStreamingContent('');
      setStreamingBlocks([]);
    } else if (idleDuringRestoreRef.current) {
      setStatus('idle');
      setProcessingStartedAt(null);
      setActiveToolName(null);
      setActiveSubAgent(null);
    } else {
      setStatus((data.state?.pendingPermission || data.state?.activeToolName) ? 'tool_use' : 'thinking');
      setProcessingStartedAt(data.state?.processingStartedAt ?? Date.now());
    }

    restoringSessionIdRef.current = null;
    idleDuringRestoreRef.current = false;

    if (switchTimeoutRef.current) {
      clearTimeout(switchTimeoutRef.current);
      switchTimeoutRef.current = null;
    }
    setIsSwitchingSession(false);
  });

  socket.on('session:compacted', (data: { oldSessionId: string; newSessionId: string; state?: any }) => {
    if (data.oldSessionId !== sessionIdRef.current) return;
    setSessionId(data.newSessionId);
    sessionIdRef.current = data.newSessionId;
    if (data.state?.messages) {
      setMessages(data.state.messages);
    }
    setHasMoreMessages(false);
    nextCursorRef.current = null;
    setStatus('idle');
  });

  socket.on('session:ended', (data: { sessionId?: string }) => {
    if (data?.sessionId && data.sessionId !== sessionIdRef.current) return;
    setSessionId(null);
    sessionIdRef.current = null;
    setStatus('idle');
  });

  socket.on('session:deleted', (data: { sessionId: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setSessionId(null);
    sessionIdRef.current = null;
    setMessages([]);
    setStreamingContent('');
    setStreamingBlocks([]);
    streamingRef.current = '';
    knownMessageIdsRef.current = new Set();
    setStatus('idle');
    setProcessingStartedAt(null);
    setActiveToolName(null);
    setActiveSubAgent(null);
    setHasMoreMessages(false);
    nextCursorRef.current = null;
    setPendingPermission(null);
    setPendingAskUser(null);
    setTodoLists([]);
    setSessionModel(undefined);
    setSessionEffortLevelState(undefined);
    setSessionPermissionModeState(undefined);
  });

  // ─── Chat message (finalized) ─────────────────────────────────────

  socket.on('chat:message', (data: { sessionId: string; message: ChatMessage }) => {
    if (data.sessionId !== sessionIdRef.current) return;

    const isUpdate = knownMessageIdsRef.current.has(data.message.id);

    if (!isUpdate) {
      knownMessageIdsRef.current.add(data.message.id);
      if (data.message.role !== 'user') {
        setStreamingBlocks([]);
        setStreamingContent('');
        streamingRef.current = '';

        if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = setTimeout(async () => {
          const sid = sessionIdRef.current;
          if (!sid) {
            idleTimeoutRef.current = null;
            return;
          }

          try {
            const { isProcessing } = await sessionsApi.getSessionStatus(sid);
            if (!isProcessing) {
              setStatus((cur) => {
                if (cur !== 'idle') {
                  setProcessingStartedAt(null);
                  setActiveSubAgent(null);
                  return 'idle';
                }
                return cur;
              });
            }
          } catch {
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
        const updated = [...prev];
        updated[existingIdx] = { ...prev[existingIdx], ...data.message };
        return updated;
      }
      return [...prev, data.message];
    });
  });

  // ─── Status + Error ───────────────────────────────────────────────

  socket.on('chat:status', (data: { sessionId: string; status: 'idle' | 'thinking' | 'tool_use'; toolName?: string; startedAt?: number }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    if (data.status === 'idle' && restoringSessionIdRef.current === data.sessionId) {
      idleDuringRestoreRef.current = true;
    }

    if (data.status === 'idle') {
      localAbortAtRef.current = null;
    }

    setStatus(data.status);
    setActiveToolName(data.status === 'tool_use' && data.toolName ? data.toolName : null);
    if (data.status === 'idle') {
      if (idleTimeoutRef.current) {
        clearTimeout(idleTimeoutRef.current);
        idleTimeoutRef.current = null;
      }
      setStreamingBlocks([]);
      setStreamingContent('');
      streamingRef.current = '';
      setProcessingStartedAt(null);
      setActiveSubAgent(null);
      // Không clear todo khi idle — giữ lại để user thấy kết quả cuối
    } else if (data.startedAt) {
      setProcessingStartedAt(data.startedAt);
    }
  });

  socket.on('chat:error', (data: { sessionId: string; error: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    const errorMsg: ChatMessage = {
      id: `error-${Date.now()}`,
      role: 'system',
      content: `[Lỗi] ${data.error}`,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, errorMsg]);
    setStatus('idle');
  });

  // ─── Effort + Permission Mode ─────────────────────────────────────

  socket.on('session:effortChanged', (data: { sessionId: string; effortLevel?: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setSessionEffortLevelState(data.effortLevel);
  });

  socket.on('session:modelChanged', (data: { sessionId: string; model?: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setSessionModel(data.model);
  });

  socket.on('session:permissionModeChanged', (data: { sessionId: string; permissionMode?: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setSessionPermissionModeState(data.permissionMode);
  });

  // ─── Permission requests ──────────────────────────────────────────

  socket.on('permission:request', (data: { sessionId: string; toolName: string; input: Record<string, unknown> }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setPendingPermission({ toolName: data.toolName, input: data.input });
  });

  socket.on('permission:resolved', (data: { sessionId: string; allowed: boolean }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setPendingPermission(null);
  });

  // ─── Sub-agent events ─────────────────────────────────────────────

  socket.on('subagent:started', (data: { sessionId: string; agentName: string; prompt: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setActiveSubAgent({ name: data.agentName, prompt: data.prompt });
  });

  socket.on('subagent:ended', (data: { sessionId: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setActiveSubAgent(null);
  });

  socket.on('task:progress', (data: { sessionId: string; taskId?: string; summary?: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setActiveSubAgent(prev => {
      if (!prev) return prev;
      return { ...prev, lastHeartbeat: Date.now() };
    });
  });

  socket.on('subagent:activity', (data: {
    sessionId: string;
    parentToolUseId: string;
    type: 'tool_start' | 'text_delta';
    toolName?: string;
    inputSummary?: string;
    text?: string;
  }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    if (data.type === 'tool_start' && data.toolName) {
      setActiveSubAgent(prev => {
        if (!prev) return prev;
        const activities = prev.activities || [];
        return {
          ...prev,
          currentToolName: data.toolName,
          lastHeartbeat: Date.now(),
          activities: [...activities, {
            toolName: data.toolName!,
            inputSummary: data.inputSummary || '',
            timestamp: Date.now(),
          }],
        };
      });
    }
  });

  // ─── MCP status ───────────────────────────────────────────────────

  socket.on('mcp:status', (data: { sessionId: string; servers: McpRuntimeServer[] }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setMcpRuntimeStatus(data.servers);
  });

  socket.on('mcp:resolved', (data: { sessionId: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setMcpRuntimeStatus(prev =>
      prev.map(s => s.status === 'pending' ? { ...s, status: 'connected' as const } : s)
    );
  });

  // ─── AskUser ──────────────────────────────────────────────────────

  socket.on('askUser:question', (data: { sessionId: string; input: Record<string, unknown> }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    const input = data.input || {};
    setPendingAskUser({
      questions: (input.questions as AskUserQuestionItem[]) || [{
        question: String(input.question || 'Claude muốn hỏi bạn'),
        options: input.options as AskUserQuestionOption[],
      }],
      metadata: input.metadata as Record<string, unknown>,
    });
  });

  socket.on('askUser:resolved', (data: { sessionId: string; answer: string }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setPendingAskUser(null);
  });

  return [
    'session:started',
    'session:compacted',
    'session:ended',
    'session:deleted',
    'chat:message',
    'chat:status',
    'chat:error',
    'session:effortChanged',
    'session:modelChanged',
    'session:permissionModeChanged',
    'permission:request',
    'permission:resolved',
    'subagent:started',
    'subagent:ended',
    'task:progress',
    'subagent:activity',
    'mcp:status',
    'mcp:resolved',
    'askUser:question',
    'askUser:resolved',
  ];
}
