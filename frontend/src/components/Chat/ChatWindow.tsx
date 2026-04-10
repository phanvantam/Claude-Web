import React, { useRef, useEffect, useCallback } from 'react';
import { Typography, Spin } from 'antd';
import {
  RobotOutlined,
  LoadingOutlined,
  BulbOutlined,
  LockOutlined,
  ThunderboltOutlined,
  MessageOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ToolOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
} from '@ant-design/icons';
import type { ChatMessage, ContentBlock } from '../../types';
import type { PendingPermission } from '../../hooks/useChat';
import ToolCallCard from './ToolCallCard';
import MessageContent from './MessageContent';

const { Text } = Typography;

/**
 * Component riêng cho live timer — tách ra để re-render timer
 * không gây re-render toàn bộ ChatWindow.
 * startedAt: timestamp (ms) khi bắt đầu — dùng để tính elapsed chính xác khi reload.
 */
const LiveTimer: React.FC<{ isActive: boolean; startedAt?: number | null }> = React.memo(({ isActive, startedAt }) => {
  const [elapsed, setElapsed] = React.useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (isActive) {
      // Tính elapsed từ startedAt thay vì 0 — reload page không reset
      const calcElapsed = () => startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0;
      setElapsed(calcElapsed());
      timerRef.current = setInterval(() => {
        setElapsed(calcElapsed());
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isActive, startedAt]);

  if (!isActive) return null;

  return (
    <Text style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 12, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
      {elapsed}s
    </Text>
  );
});

interface ChatWindowProps {
  messages: ChatMessage[];
  streamingContent: string;
  streamingBlocks: ContentBlock[];
  isThinking: boolean;
  status: 'idle' | 'initializing' | 'thinking' | 'tool_use';
  /** Còn messages cũ hơn chưa tải không */
  hasMoreMessages?: boolean;
  /** Đang tải messages cũ hơn không */
  isLoadingMore?: boolean;
  /** Callback tải thêm messages cũ hơn */
  onLoadMore?: () => void;
  /** Tool đang chờ xác nhận permission */
  pendingPermission?: PendingPermission | null;
  /** Tên tool đang chạy (status = 'tool_use') */
  activeToolName?: string | null;
  /** Timestamp (ms) khi bắt đầu processing — dùng cho elapsed timer */
  processingStartedAt?: number | null;
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  streamingContent,
  streamingBlocks,
  isThinking,
  status,
  hasMoreMessages = false,
  isLoadingMore = false,
  onLoadMore,
  pendingPermission,
  activeToolName,
  processingStartedAt,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Timer đã tách thành component LiveTimer — không cần state ở đây nữa
  // Lưu vị trí scroll trước khi prepend messages cũ
  const prevScrollHeightRef = useRef<number>(0);
  const shouldRestoreScrollRef = useRef(false);

  // Cuộn xuống cuối khi có message mới (không cuộn khi đang load cũ)
  useEffect(() => {
    if (!shouldRestoreScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingContent, streamingBlocks]);

  // Khôi phục vị trí scroll sau khi prepend messages cũ
  useEffect(() => {
    if (shouldRestoreScrollRef.current && containerRef.current) {
      const newScrollHeight = containerRef.current.scrollHeight;
      const addedHeight = newScrollHeight - prevScrollHeightRef.current;
      containerRef.current.scrollTop = addedHeight;
      shouldRestoreScrollRef.current = false;
    }
  }, [messages]);

  /**
   * Phát hiện scroll lên đầu để tải thêm messages cũ.
   * Kích hoạt khi scrollTop < 100px.
   */
  const handleScroll = useCallback(() => {
    if (!containerRef.current || !hasMoreMessages || isLoadingMore || !onLoadMore) return;

    if (containerRef.current.scrollTop < 100) {
      // Lưu scrollHeight trước khi prepend
      prevScrollHeightRef.current = containerRef.current.scrollHeight;
      shouldRestoreScrollRef.current = true;
      onLoadMore();
    }
  }, [hasMoreMessages, isLoadingMore, onLoadMore]);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /** Render assistant message blocks dạng timeline dọc */
  const renderAssistantBlocks = (msg: ChatMessage) => {
    const blocks = msg.blocks || [];
    
    // Nếu không có blocks, dùng fallback từ content và toolCalls (hỗ trợ dữ liệu cũ)
    if (blocks.length === 0) {
      const fallback: ContentBlock[] = [];
      if (msg.content) {
        fallback.push({ type: 'text', text: msg.content });
      }
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        for (const tc of msg.toolCalls) {
          fallback.push({ type: 'tool_use', tool: tc });
        }
      }
      if (fallback.length === 0) return null;
      return renderBlockList(fallback);
    }

    return renderBlockList(blocks);
  };

  /**
   * Xác định CSS class và icon cho dot trên timeline.
   * Mỗi block type có visual identity riêng để dễ nhận biết.
   */
  const getBlockDot = (block: ContentBlock, isStreaming: boolean, isLast: boolean) => {
    if (block.type === 'thinking') {
      return {
        className: 'tl-dot dot-thinking-content',
        icon: <BulbOutlined style={{ fontSize: 12 }} />,
      };
    }
    if (block.type === 'tool_use') {
      const tool = block.tool;
      // Phân biệt trạng thái tool: thành công/lỗi/đang chạy
      if (tool.result !== undefined) {
        return tool.isError
          ? { className: 'tl-dot dot-tool-error', icon: <CloseCircleOutlined style={{ fontSize: 11 }} /> }
          : { className: 'tl-dot dot-tool-success', icon: <CheckCircleOutlined style={{ fontSize: 11 }} /> };
      }
      // Tool không có explicit result nhưng message đã finalized → coi như success
      // (SDK trả tool_result trong message riêng, không gắn vào block này)
      if (!isStreaming) {
        return { className: 'tl-dot dot-tool-success', icon: <CheckCircleOutlined style={{ fontSize: 11 }} /> };
      }
      // Tool chưa có result — đang chạy hoặc pending
      return { className: `tl-dot dot-tool${isLast ? ' streaming' : ''}`, icon: <ToolOutlined style={{ fontSize: 11 }} /> };
    }
    // Text block
    return {
      className: `tl-dot dot-text${isStreaming && isLast ? ' streaming' : ''}`,
      icon: <MessageOutlined style={{ fontSize: 10 }} />,
    };
  };

  const renderBlockList = (blocks: ContentBlock[], isStreaming = false) => {
    return (
      <>
        {blocks.map((block, i) => {
          const isLast = i === blocks.length - 1;
          const dot = getBlockDot(block, isStreaming, isLast);

          if (block.type === 'thinking') {
            return (
              <div key={`block-${i}`} className="tl-block-row">
                <div className={dot.className}>{dot.icon}</div>
                <div className="tl-block-content tl-thinking-block">
                  <div className="thinking-text">{block.thinking}</div>
                </div>
              </div>
            );
          }

          return (
            <div key={`block-${i}`} className="tl-block-row">
              <div className={dot.className}>{dot.icon}</div>
              <div className="tl-block-content">
                {block.type === 'text' ? (
                  <>
                    <MessageContent content={block.text} />
                    {isStreaming && isLast && <span className="cursor-blink">▊</span>}
                  </>
                ) : (
                  <ToolCallCard toolCall={block.tool} isFinalized={!isStreaming} />
                )}
              </div>
            </div>
          );
        })}
      </>
    );
  };

  const hasStreamingData = streamingBlocks.length > 0;

  return (
    <div
      className="chat-window"
      ref={containerRef}
      onScroll={handleScroll}
    >
      {/* Indicator tải thêm messages cũ */}
      {isLoadingMore && (
        <div className="chat-load-more">
          <Spin indicator={<LoadingOutlined style={{ fontSize: 16, color: '#6c5ce7' }} />} />
          <Text style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 8, fontSize: 13 }}>
            Đang tải tin nhắn cũ hơn...
          </Text>
        </div>
      )}

      {/* Thông báo khi còn messages cũ hơn */}
      {hasMoreMessages && !isLoadingMore && (
        <div className="chat-load-more">
          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
            ↑ Cuộn lên để tải thêm
          </Text>
        </div>
      )}

      {messages.length === 0 && !isThinking && !hasStreamingData && (
        <div className="chat-empty">
          <RobotOutlined style={{ fontSize: 64, color: '#6c5ce7', opacity: 0.5 }} />
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 16, marginTop: 16 }}>
            Bắt đầu cuộc hội thoại mới với Claude
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.2)', fontSize: 13, marginTop: 4 }}>
            Gõ tiếng Việt thoải mái — không lo lỗi ký tự!
          </Text>
        </div>
      )}

      {messages.map((msg) => {
        if (msg.role === 'user') {
          return (
            <div key={msg.id} className="tl-user-row">
              <div className="tl-user-bubble">
                {msg.content}
              </div>
              <span className="tl-time">{formatTime(msg.timestamp)}</span>
            </div>
          );
        }

        if (msg.role === 'system') {
          return (
            <div key={msg.id} className="tl-system-row">
              <span className="tl-system-text">{msg.content}</span>
            </div>
          );
        }

        // Assistant: two-column timeline layout
        return (
          <div key={msg.id} className="tl-assistant-row">
            <div className="tl-line-col">
              <div className="tl-line" />
            </div>
            <div className="tl-content-col">
              {renderAssistantBlocks(msg)}
              {/* Meta: hiện ở mỗi assistant message để theo dõi chi tiết từng turn */}
              <div className="tl-meta">
                <span className="tl-time">{formatTime(msg.timestamp)}</span>
                {msg.model && <span className="tl-model">{msg.model}</span>}
                {msg.durationMs !== undefined && msg.durationMs > 0 && (
                  <span className="tl-duration"><ClockCircleOutlined style={{ marginRight: 3 }} />{(msg.durationMs / 1000).toFixed(1)}s</span>
                )}
                {msg.tokens && (msg.tokens.input + msg.tokens.output) > 0 && (
                  <span className="tl-tokens">
                    {msg.tokens.input + msg.tokens.output} tokens
                  </span>
                )}
                {msg.cost !== undefined && msg.cost > 0 && (
                  <span className="tl-cost">${msg.cost.toFixed(4)}</span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Live streaming blocks — same two-column layout */}
      {(hasStreamingData || isThinking) && (
        <div className="tl-assistant-row">
          <div className="tl-line-col">
            <div className={`tl-line ${isThinking ? 'thinking' : 'streaming'}`} />
          </div>
          <div className="tl-content-col">
            {/* Streaming blocks — collapse/expand */}
            {hasStreamingData && renderBlockList(streamingBlocks, true)}

            {/* Status indicator + timer + cancel */}
            {isThinking && (
              <div className="tl-block-row tl-thinking-row">
                <div className="tl-dot dot-thinking">
                  <LoadingOutlined style={{ fontSize: 11 }} />
                </div>
                <div className="tl-thinking">
                  <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 13 }}>
                    {pendingPermission
                      ? <><LockOutlined style={{ marginRight: 4 }} /> Chờ xác nhận: {pendingPermission.toolName}</>
                      : status === 'initializing'
                        ? <><CloudServerOutlined style={{ marginRight: 4 }} /> Đang khởi tạo MCP...</>
                        : status === 'tool_use'
                          ? <><ThunderboltOutlined style={{ marginRight: 4 }} /> {activeToolName ? `Đang chạy: ${activeToolName}` : 'Đang sử dụng công cụ'}...</>
                          : 'Đang xử lý...'}
                  </Text>
                  <LiveTimer isActive={isThinking} startedAt={processingStartedAt} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
};

export default ChatWindow;
