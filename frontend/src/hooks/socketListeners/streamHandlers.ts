/**
 * Đăng ký các socket event liên quan đến streaming nội dung:
 * chat:stream, chat:stream:tool, chat:stream:block_start/delta/stop
 *
 * Tách từ useChatSocketListeners.ts — nhóm handlers theo chức năng.
 */

import type { Socket } from 'socket.io-client';
import type { SocketHandlerDeps } from './types';

/**
 * Đăng ký stream handlers. Trả về danh sách event names đã đăng ký
 * để caller gọi socket.off() khi cleanup.
 */
export function registerStreamHandlers(socket: Socket, deps: SocketHandlerDeps): string[] {
  const {
    setStreamingContent,
    setStreamingBlocks,
    streamingRef,
    sessionIdRef,
  } = deps;

  // Text stream — tích lũy nội dung text
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

  // Tool call hoàn chỉnh (fallback khi không có stream block events)
  socket.on('chat:stream:tool', (data: { sessionId: string; tool: { id: string; name: string; input: Record<string, unknown> } }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setStreamingBlocks(prev => [...prev, { type: 'tool_use', tool: { ...data.tool } }]);
  });

  // Partial message placeholder — hiện tại không xử lý
  socket.on('chat:stream:partial', () => {});

  // Tool/thinking block bắt đầu stream — tạo slot trong blocks array
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

  // Delta chunks — tích lũy input JSON hoặc thinking text
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

  // Block kết thúc — parse JSON input đã tích lũy
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

  // Đồng bộ toàn bộ blocks hiện tại — backend emit sau khi tool_result xử lý xong.
  // Thay thế streamingBlocks để tool card chuyển từ "loading" → "hoàn thành" tức thì.
  socket.on('chat:stream:blocks', (data: {
    sessionId: string;
    blocks: import('../../types').ContentBlock[];
  }) => {
    if (data.sessionId !== sessionIdRef.current) return;
    setStreamingBlocks(data.blocks);

    // Đồng bộ streamingRef với text block cuối — tránh text bị append sai
    // khi chat:stream event tiếp theo đến sau stream:blocks
    const lastTextBlock = [...data.blocks].reverse().find(b => b.type === 'text');
    if (lastTextBlock && lastTextBlock.type === 'text') {
      streamingRef.current = lastTextBlock.text;
      setStreamingContent(lastTextBlock.text);
    }
  });

  return [
    'chat:stream',
    'chat:stream:tool',
    'chat:stream:partial',
    'chat:stream:block_start',
    'chat:stream:block_delta',
    'chat:stream:block_stop',
    'chat:stream:blocks',
  ];
}
