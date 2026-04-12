import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  CaretRightOutlined,
  CaretDownOutlined,
  BarChartOutlined,
  BookOutlined,
  SyncOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import type { ChatMessage, ContentBlock, SubAgentActivity } from '../../types';
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

/**
 * Card hiển thị kết quả sub-agent trên timeline chính.
 * - Header: tên agent + trạng thái (thành công/lỗi) + toggle mở/đóng
 * - Collapsible: danh sách tool calls nội bộ (activities)
 * - Footer: nội dung kết quả tóm tắt
 */
const SubAgentResultCard: React.FC<{
  agentName: string;
  result: string;
  isError?: boolean;
  activities?: SubAgentActivity[];
  usage?: { tokens: number; tools: number; durationMs: number };
  agentId?: string;
}> = ({ agentName, result, isError, activities, usage, agentId }) => {
  const [expanded, setExpanded] = useState(false);
  const hasActivities = activities && activities.length > 0;

  return (
    <div className={`tl-subagent-result-card ${isError ? 'error' : 'success'}`}>
      {/* Header: tên + status + toggle */}
      <div className="subagent-result-header" onClick={() => hasActivities && setExpanded(!expanded)}>
        <span className="subagent-result-icon">
          {isError
            ? <CloseCircleOutlined style={{ color: 'var(--danger)', fontSize: 12 }} />
            : <CheckCircleOutlined style={{ color: 'var(--success)', fontSize: 12 }} />
          }
        </span>
        <Text strong style={{ fontSize: 13, color: 'var(--accent-light)' }}>
          {agentName}
        </Text>
        {hasActivities && (
          <span className="subagent-result-count">
            {activities.length} bước
          </span>
        )}
        {hasActivities && (
          <span className="subagent-result-toggle">
            {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
          </span>
        )}

        {/* Usage stats — hiện bên phải header */}
        {usage && (
          <div className="subagent-usage-chips">
            <span title="Tổng tokens sử dụng">
              <MessageOutlined style={{ fontSize: 10 }} /> {usage.tokens.toLocaleString()}
            </span>
            <span title="Số công cụ đã dùng">
              <ToolOutlined style={{ fontSize: 10 }} /> {usage.tools}
            </span>
            <span title="Thời gian chạy">
              <ClockCircleOutlined style={{ fontSize: 10 }} /> {(usage.durationMs / 1000).toFixed(1)}s
            </span>
            {agentId && (
              <span className="agent-id-chip" title="Agent ID">
                ID: {agentId}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Collapsible activities — tool calls nội bộ sub-agent */}
      {expanded && hasActivities && (
        <div className="subagent-activities-list">
          {activities.map((act, idx) => (
            <div key={idx} className="subagent-activity-item">
              <span className={`subagent-activity-status ${act.isError ? 'error' : act.result ? 'done' : ''}`}>
                {act.isError
                  ? <CloseCircleOutlined style={{ fontSize: 10 }} />
                  : act.result
                    ? <CheckCircleOutlined style={{ fontSize: 10 }} />
                    : <ToolOutlined style={{ fontSize: 10 }} />
                }
              </span>
              <span className="subagent-activity-name">{act.name}</span>
              <span className="subagent-activity-summary">
                {act.input && typeof act.input === 'object'
                  ? Object.entries(act.input).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(', ')
                  : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Result text — luôn hiện */}
      <div className="subagent-result-body">
        <MessageContent content={result} />
      </div>
    </div>
  );
};

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
  /** Sub-agent đang chạy — hiện indicator trước thinking row */
  activeSubAgent?: {
    name: string;
    prompt: string;
    lastHeartbeat?: number;
    activities?: Array<{ toolName: string; inputSummary?: string; timestamp: number }>;
    currentToolName?: string;
  } | null;
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
  activeSubAgent,
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
    if (block.type === 'subagent_result') {
      return {
        className: `tl-dot dot-subagent-result${block.isError ? ' error' : ' success'}`,
        icon: <RobotOutlined style={{ fontSize: 11 }} />,
      };
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

          if (block.type === 'subagent_result') {
            return (
              <div key={`block-${i}`} className="tl-block-row">
                <div className={dot.className}>{dot.icon}</div>
                <div className="tl-block-content">
                  <SubAgentResultCard
                    agentName={block.agentName}
                    result={block.result}
                    isError={block.isError}
                    activities={block.activities}
                    usage={block.usage}
                    agentId={block.agentId}
                  />
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
                  <ToolCallCard
                    toolCall={(block as any).tool}
                    isFinalized={!isStreaming}
                    activeSubAgent={activeSubAgent}
                  />
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
          // Detect header to add icon
          let icon = null;
          if (msg.content.includes('### Thống kê phiên')) icon = <BarChartOutlined />;
          else if (msg.content.includes('### Trạng thái phiên')) icon = <InfoCircleOutlined />;
          else if (msg.content.includes('### Danh sách lệnh')) icon = <BookOutlined />;
          else if (msg.content.includes('### Thay đổi Model') || msg.content.includes('### Thông tin Model')) icon = <RobotOutlined />;
          else if (msg.content.includes('nén context')) icon = <SyncOutlined />;

          return (
            <div key={msg.id} className="tl-system-row">
              <div className="tl-system-content">
                {icon && <div className="tl-system-icon-wrapper">{icon}</div>}
                <MessageContent content={msg.content} />
              </div>
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


            {/* Sub-agent info hiện trực tiếp bên trong Agent tool card (expanded) — không cần indicator riêng */}

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
