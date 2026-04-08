import { useState, useCallback, useEffect, useRef } from 'react';
import { socketService } from '../services/socket';
import type { ChatMessage, ContentBlock, ToolCall } from '../types';

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

  useEffect(() => {
    const socket = socketService.connect();

    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    // Session started or attached
    socket.on('session:started', (data: { sessionId: string; state?: { messages: ChatMessage[]; isProcessing: boolean } }) => {
      console.log(`[useChat] session:started received ID: ${data.sessionId}, message count: ${data.state?.messages?.length || 0}`);
      setSessionId(data.sessionId);
      if (data.state) {
        // Deduplicate messages by ID just in case
        const uniqueMessages = Array.from(
          new Map((data.state.messages || []).map(m => [m.id, m])).values()
        );
        setMessages(uniqueMessages);
        setStatus(data.state.isProcessing ? 'thinking' : 'idle');
      }
    });

    // New chat message (user or assistant) — final complete message
    socket.on('chat:message', (data: { sessionId: string; message: ChatMessage }) => {
      // Clear streaming state
      streamingRef.current = '';
      setStreamingContent('');
      setStreamingBlocks([]);
      setStatus('idle');

      setMessages((prev) => {
        // Prevent adding the same message ID twice
        if (prev.find(m => m.id === data.message.id)) return prev;
        return [...prev, data.message];
      });
    });

    // Streaming text delta — append to current text
    socket.on('chat:stream', (data: { sessionId: string; content: string }) => {
      streamingRef.current += data.content;
      setStreamingContent(streamingRef.current);

      // Also update streamingBlocks: append to last text block or create new
      setStreamingBlocks((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.type === 'text') {
          const updated = [...prev];
          updated[updated.length - 1] = { type: 'text', text: last.text + data.content };
          return updated;
        }
        return [...prev, { type: 'text', text: data.content }];
      });
    });

    // Streaming tool start — a new tool_use block appeared
    socket.on('chat:stream:tool', (data: { sessionId: string; tool: ToolCall }) => {
      setStreamingBlocks((prev) => [...prev, { type: 'tool_use', tool: data.tool }]);
    });

    // Partial assistant message — full blocks update from --include-partial-messages
    // Replace streaming blocks wholesale with the authoritative partial state
    socket.on('chat:stream:partial', (data: { sessionId: string; blocks: ContentBlock[] }) => {
      setStreamingBlocks(data.blocks);
    });

    // Status updates
    socket.on('chat:status', (data: { sessionId: string; status: 'idle' | 'thinking' | 'tool_use' }) => {
      setStatus(data.status);
      if (data.status === 'thinking') {
        // Reset streaming for new message
        streamingRef.current = '';
        setStreamingContent('');
        setStreamingBlocks([]);
      } else if (data.status === 'idle') {
        // Ensure no stale streaming UI remains after turn completion
        streamingRef.current = '';
        setStreamingContent('');
        setStreamingBlocks([]);
      }
    });

    // Errors
    socket.on('chat:error', (data: { sessionId: string; error: string }) => {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'system',
        content: `❌ Error: ${data.error}`,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
      setStatus('idle');
    });

    // Session ended
    socket.on('session:ended', () => {
      setSessionId(null);
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
    // Clear previous session state
    setMessages([]);
    setStreamingContent('');
    setStreamingBlocks([]);
    streamingRef.current = '';
    setStatus('idle');
    setSessionId(null);

    // Always use session:start — backend handles both new and resume
    socket?.emit('session:start', { projectId, sessionId: existingSessionId });
  }, []);

  const sendMessage = useCallback((text: string) => {
    if (!sessionId) return;
    const socket = socketService.getSocket();
    socket?.emit('chat:send', { sessionId, message: text });
  }, [sessionId]);

  const abortGeneration = useCallback(() => {
    if (!sessionId) return;
    const socket = socketService.getSocket();
    socket?.emit('chat:abort', { sessionId });
    setStatus('idle');
    setStreamingBlocks([]);
    setStreamingContent('');
    streamingRef.current = '';
  }, [sessionId]);

  const stopSession = useCallback(() => {
    if (!sessionId) return;
    const socket = socketService.getSocket();
    socket?.emit('session:stop', { sessionId });
    setSessionId(null);
  }, [sessionId]);

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
