import { useState, useCallback, useEffect, useRef } from 'react';
import { socketService } from '../services/socket';
import type { ChatMessage, ContentBlock } from '../types';

interface UseChatReturn {
  messages: ChatMessage[];
  streamingContent: string;
  streamingBlocks: ContentBlock[];
  isConnected: boolean;
  isThinking: boolean;
  status: 'idle' | 'thinking' | 'tool_use';
  sessionId: string | null;
  startSession: (projectId: string, existingSessionId?: string) => void;
  sendMessage: (text: string) => void;
  abortGeneration: () => void;
  stopSession: () => void;
  clearMessages: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [status, setStatus] = useState<'idle' | 'thinking' | 'tool_use'>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const streamingRef = useRef('');
  // Keep a ref so reconnect handler always has the latest sessionId
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = socketService.connect();

    socket.on('connect', () => {
      console.log('[useChat] Socket connected');
      setIsConnected(true);

      // Re-attach to session after reconnect so we rejoin the room
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

    // Session started or attached
    socket.on('session:started', (data: { sessionId: string; state?: { messages: ChatMessage[]; isProcessing: boolean } }) => {
      console.log(`[useChat] session:started ID=${data.sessionId}, msgs=${data.state?.messages?.length || 0}, processing=${data.state?.isProcessing}`);
      setSessionId(data.sessionId);
      sessionIdRef.current = data.sessionId;
      if (data.state) {
        const uniqueMessages = Array.from(
          new Map((data.state.messages || []).map(m => [m.id, m])).values()
        );
        setMessages(uniqueMessages);
        if (!data.state.isProcessing) {
          // If not processing, force idle and clear any stale streaming
          setStatus('idle');
          streamingRef.current = '';
          setStreamingContent('');
          setStreamingBlocks([]);
        } else {
          setStatus('thinking');
        }
      }
    });

    // New chat message (user or assistant) — final complete message
    socket.on('chat:message', (data: { sessionId: string; message: ChatMessage }) => {
      console.log(`[useChat] New message received: ${data.message.role}`);
      
      // Clear streaming state when any non-user message arrives
      // Note: We NO LONGER setStatus('idle') here, we wait for chat:status
      if (data.message.role !== 'user') {
        setStreamingBlocks([]);
        setStreamingContent('');
        streamingRef.current = '';
      }

      setMessages((prev) => {
        // Prevent adding the same message ID twice
        if (prev.find(m => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
    });

    // We keep these empty or simplified since streaming is disabled on backend
    socket.on('chat:stream', () => {});
    socket.on('chat:stream:tool', () => {});
    socket.on('chat:stream:partial', () => {});

    // Status updates
    socket.on('chat:status', (data: { sessionId: string; status: 'idle' | 'thinking' | 'tool_use' }) => {
      console.log(`[useChat] Status changed to: ${data.status}`);
      setStatus(data.status);
      if (data.status === 'idle') {
        setStreamingBlocks([]);
        setStreamingContent('');
        streamingRef.current = '';
      }
    });

    // Errors
    socket.on('chat:error', (data: { sessionId: string; error: string }) => {
      console.error(`[useChat] Error: ${data.error}`);
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `❌ Lỗi: ${data.error}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setStatus('idle');
    });

    // Session ended
    socket.on('session:ended', () => {
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
      socket.off('session:ended');
    };
  }, []);

  const startSession = useCallback((projectId: string, existingSessionId?: string) => {
    const socket = socketService.getSocket();
    setMessages([]);
    setStreamingContent('');
    setStreamingBlocks([]);
    streamingRef.current = '';
    setStatus('idle');
    setSessionId(null);
    sessionIdRef.current = null;

    socket?.emit('session:start', { projectId, sessionId: existingSessionId });
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (!sessionIdRef.current) return;
    const socket = socketService.getSocket();
    socket?.emit('chat:send', { sessionId: sessionIdRef.current, message: text });
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

  return {
    messages,
    streamingContent,
    streamingBlocks,
    isConnected,
    isThinking: status !== 'idle',
    status,
    sessionId,
    startSession,
    sendMessage,
    abortGeneration,
    stopSession,
    clearMessages,
  };
}
