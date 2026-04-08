import React, { useRef, useEffect } from 'react';
import { Typography, Spin } from 'antd';
import {
  RobotOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { ChatMessage, ContentBlock } from '../../types';
import ToolCallCard from './ToolCallCard';
import MessageContent from './MessageContent';

const { Text } = Typography;

interface ChatWindowProps {
  messages: ChatMessage[];
  streamingContent: string;
  streamingBlocks: ContentBlock[];
  isThinking: boolean;
  status: 'idle' | 'thinking' | 'tool_use';
}

const ChatWindow: React.FC<ChatWindowProps> = ({
  messages,
  streamingContent,
  streamingBlocks,
  isThinking,
  status,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, streamingBlocks]);

  // Handle live timer
  useEffect(() => {
    if (isThinking) {
      setElapsed(0);
      timerRef.current = setInterval(() => {
        setElapsed(prev => prev + 0.1);
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isThinking]);

  const formatTime = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  /** Render assistant message blocks as a vertical timeline */
  const renderAssistantBlocks = (msg: ChatMessage) => {
    const blocks: ContentBlock[] = msg.blocks || [];

    // Fallback: if no blocks, create from content + toolCalls (backward compat)
    if (blocks.length === 0) {
      const fallback: ContentBlock[] = [];
      if (msg.content) {
        fallback.push({ type: 'text', text: msg.content });
      }
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          fallback.push({ type: 'tool_use', tool: tc });
        }
      }
      if (fallback.length === 0) return null;
      return renderBlockList(fallback);
    }

    return renderBlockList(blocks);
  };

  const renderBlockList = (blocks: ContentBlock[], isStreaming = false) => {
    return (
      <>
        {blocks.map((block, i) => {
          const isLast = i === blocks.length - 1;
          return (
            <div key={`block-${i}`} className="tl-block-row">
              {/* Dot — positioned absolutely on the timeline line */}
              <div className={`tl-dot ${block.type === 'tool_use' ? 'dot-tool' : 'dot-text'}${isStreaming && isLast ? ' streaming' : ''}`} />
              <div className="tl-block-content">
                {block.type === 'text' ? (
                  <>
                    <MessageContent content={block.text} />
                    {isStreaming && isLast && <span className="cursor-blink">▊</span>}
                  </>
                ) : (
                  <ToolCallCard toolCall={block.tool} />
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
    <div className="chat-window">
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
        //   [line-col 28px] | [content area]
        //   The line-col draws a single continuous vertical line.
        //   Each block has a dot absolutely positioned on that line.
        return (
          <div key={msg.id} className="tl-assistant-row">
            <div className="tl-line-col">
              <div className="tl-line" />
            </div>
            <div className="tl-content-col">
              {renderAssistantBlocks(msg)}
              {/* Meta: model / tokens / cost */}
              <div className="tl-meta">
                <span className="tl-time">{formatTime(msg.timestamp)}</span>
                {msg.model && <span className="tl-model">{msg.model}</span>}
                {msg.tokens && (
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
            {hasStreamingData && renderBlockList(streamingBlocks, true)}

            {/* Thinking / Status indicator */}
            {isThinking && (
              <div className="tl-block-row tl-thinking-row">
                <div className="tl-dot dot-thinking" />
                <div className="tl-thinking">
                  <Spin indicator={<LoadingOutlined style={{ fontSize: 14, color: '#6c5ce7' }} />} />
                  <Text style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 8, fontSize: 13 }}>
                    {status === 'tool_use' ? 'Đang sử dụng công cụ...' : 'Đang suy nghĩ...'}
                  </Text>
                  <Text style={{ color: 'rgba(255,255,255,0.3)', marginLeft: 12, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {elapsed.toFixed(1)}s
                  </Text>
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
