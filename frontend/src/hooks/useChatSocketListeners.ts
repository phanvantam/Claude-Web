import { useEffect } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { socketService } from '../services/socket';
import { sessionsApi } from '../services/api';
import type { ChatMessage, ContentBlock } from '../types';
import type {
  PendingPermission,
  PendingAskUser,
  AskUserQuestionItem,
  AskUserQuestionOption,
  McpRuntimeServer,
} from './useChat';

type ChatStatus = 'idle' | 'initializing' | 'thinking' | 'tool_use';

type ActiveSubAgent = {
  name: string;
  prompt: string;
  lastHeartbeat?: number;
  activities?: Array<{ toolName: string; inputSummary?: string; timestamp: number }>;
  currentToolName?: string;
};

interface SessionStartedState {
  messages: ChatMessage[];
  isProcessing: boolean;
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  pendingPermission?: PendingPermission;
  processingStartedAt?: number;
  activeToolName?: string;
  activeSubAgent?: ActiveSubAgent;
  partialAssistantBlocks?: ContentBlock[];
  partialAssistantContent?: string;
}

interface UseChatSocketListenersParams {
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setStreamingBlocks: Dispatch<SetStateAction<ContentBlock[]>>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setActiveToolName: Dispatch<SetStateAction<string | null>>;
  setProcessingStartedAt: Dispatch<SetStateAction<number | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setHasMoreMessages: Dispatch<SetStateAction<boolean>>;
  setSessionModel: Dispatch<SetStateAction<string | undefined>>;
  setSessionEffortLevelState: Dispatch<SetStateAction<string | undefined>>;
  setSessionPermissionModeState: Dispatch<SetStateAction<string | undefined>>;
  setPendingPermission: Dispatch<SetStateAction<PendingPermission | null>>;
  setIsSwitchingSession: Dispatch<SetStateAction<boolean>>;
  setActiveSubAgent: Dispatch<SetStateAction<ActiveSubAgent | null>>;
  setPendingAskUser: Dispatch<SetStateAction<PendingAskUser | null>>;
  setMcpRuntimeStatus: Dispatch<SetStateAction<McpRuntimeServer[]>>;
  streamingRef: MutableRefObject<string>;
  sessionIdRef: MutableRefObject<string | null>;
  pendingSessionIdRef: MutableRefObject<string | null>;
  nextCursorRef: MutableRefObject<number | null>;
  knownMessageIdsRef: MutableRefObject<Set<string>>;
  idleTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  restoringSessionIdRef: MutableRefObject<string | null>;
  idleDuringRestoreRef: MutableRefObject<boolean>;
  switchTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

export function useChatSocketListeners({
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
  streamingRef,
  sessionIdRef,
  pendingSessionIdRef,
  nextCursorRef,
  knownMessageIdsRef,
  idleTimeoutRef,
  restoringSessionIdRef,
  idleDuringRestoreRef,
  switchTimeoutRef,
}: UseChatSocketListenersParams): void {
  useEffect(() => {
    const socket = socketService.connect();

    socket.on('connect', () => {
      setIsConnected(true);

      const sid = sessionIdRef.current;
      if (sid) {
        socket.emit('session:attach', { sessionId: sid });
      }
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

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
      } catch {
        if (data.state?.messages) {
          setMessages(data.state.messages);
        }
        setHasMoreMessages(false);
        nextCursorRef.current = null;
      }

      if (data.state?.model) setSessionModel(data.state.model);
      if (data.state?.effortLevel) setSessionEffortLevelState(data.state.effortLevel);
      if (data.state?.permissionMode) setSessionPermissionModeState(data.state.permissionMode);

      if (data.state?.pendingPermission) setPendingPermission(data.state.pendingPermission);
      else setPendingPermission(null);

      setActiveToolName(data.state?.activeToolName || null);
      setActiveSubAgent(data.state?.activeSubAgent || null);

      if (data.state?.partialAssistantBlocks?.length) {
        setStreamingBlocks(data.state.partialAssistantBlocks);
        setStreamingContent(data.state.partialAssistantContent || '');
        streamingRef.current = data.state.partialAssistantContent || '';
      }

      if (!wasProcessing) {
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

    socket.on('chat:stream', (data: { sessionId: string; content: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      streamingRef.current += data.content;
      setStreamingContent(streamingRef.current);
      setStreamingBlocks(prev => {
        const last = prev[prev.length - 1];
        if (last && last.type === 'text') {
          const updated = [...prev];
          updated[updated.length - 1] = { type: 'text', text: streamingRef.current };
          return updated;
        }
        return [...prev, { type: 'text', text: streamingRef.current }];
      });
    });

    socket.on('chat:stream:tool', (data: { sessionId: string; tool: { id: string; name: string; input: Record<string, unknown> } }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setStreamingBlocks(prev => [...prev, { type: 'tool_use', tool: { ...data.tool } }]);
    });

    socket.on('chat:stream:partial', () => {});

    socket.on('chat:stream:block_start', (data: {
      sessionId: string;
      blockIndex: number;
      blockType: 'text' | 'thinking' | 'tool_use';
      toolName?: string;
      toolId?: string;
    }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      if (data.blockType === 'tool_use' && data.toolName) {
        setStreamingBlocks(prev => [
          ...prev,
          {
            type: 'tool_use',
            tool: {
              id: data.toolId || `stream-${data.blockIndex}`,
              name: data.toolName || 'unknown',
              input: {},
              streamingInput: '',
            },
          },
        ]);
      } else if (data.blockType === 'thinking') {
        setStreamingBlocks(prev => [...prev, { type: 'thinking', thinking: '' }]);
      }
    });

    socket.on('chat:stream:block_delta', (data: {
      sessionId: string;
      blockIndex: number;
      deltaType: 'input_json_delta' | 'thinking_delta';
      chunk: string;
      accumulated?: string;
      toolName?: string;
    }) => {
      if (data.sessionId !== sessionIdRef.current) return;

      if (data.deltaType === 'input_json_delta') {
        setStreamingBlocks(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0) return prev;
          const last = prev[lastIdx];
          if (last.type !== 'tool_use') return prev;
          const updated = [...prev];
          updated[lastIdx] = {
            ...last,
            tool: {
              ...last.tool,
              streamingInput: data.accumulated || '',
            },
          };
          return updated;
        });
      } else if (data.deltaType === 'thinking_delta') {
        setStreamingBlocks(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0) return prev;
          const last = prev[lastIdx];
          if (last.type !== 'thinking') return prev;
          const updated = [...prev];
          updated[lastIdx] = {
            ...last,
            thinking: last.thinking + data.chunk,
          };
          return updated;
        });
      }
    });

    socket.on('chat:stream:block_stop', (data: {
      sessionId: string;
      blockIndex: number;
      blockType: string;
    }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      if (data.blockType === 'tool_use') {
        setStreamingBlocks(prev => {
          const lastIdx = prev.length - 1;
          if (lastIdx < 0) return prev;
          const last = prev[lastIdx];
          if (last.type !== 'tool_use') return prev;
          const updated = [...prev];
          const tool = last.tool;
          let parsedInput = tool.input;
          if ((tool as any).streamingInput) {
            try {
              parsedInput = JSON.parse((tool as any).streamingInput);
            } catch {
              // no-op
            }
          }
          updated[lastIdx] = {
            ...last,
            tool: { ...tool, input: parsedInput, streamingInput: undefined } as any,
          };
          return updated;
        });
      }
    });

    socket.on('chat:status', (data: { sessionId: string; status: 'idle' | 'thinking' | 'tool_use'; toolName?: string; startedAt?: number }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      if (data.status === 'idle' && restoringSessionIdRef.current === data.sessionId) {
        idleDuringRestoreRef.current = true;
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

    socket.on('session:effortChanged', (data: { sessionId: string; effortLevel?: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setSessionEffortLevelState(data.effortLevel);
    });

    socket.on('session:permissionModeChanged', (data: { sessionId: string; permissionMode?: string }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setSessionPermissionModeState(data.permissionMode);
    });

    socket.on('permission:request', (data: { sessionId: string; toolName: string; input: Record<string, unknown> }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setPendingPermission({ toolName: data.toolName, input: data.input });
    });

    socket.on('permission:resolved', (data: { sessionId: string; allowed: boolean }) => {
      if (data.sessionId !== sessionIdRef.current) return;
      setPendingPermission(null);
    });

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
      socket.off('permission:resolved');
      socket.off('subagent:started');
      socket.off('subagent:ended');
      socket.off('task:progress');
      socket.off('askUser:question');
      socket.off('askUser:resolved');
      socket.off('session:ended');
      socket.off('session:compacted');
      socket.off('chat:stream:block_start');
      socket.off('chat:stream:block_delta');
      socket.off('chat:stream:block_stop');
      socket.off('subagent:activity');
      socketService.release();
    };
  }, []);
}
