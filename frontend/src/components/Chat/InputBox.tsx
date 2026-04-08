import React, { useState, useRef, useEffect } from 'react';
import { Button, Tooltip } from 'antd';
import {
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';

interface InputBoxProps {
  onSend: (message: string) => void;
  onAbort: () => void;
  disabled: boolean;
  isThinking: boolean;
}

const InputBox: React.FC<InputBoxProps> = ({ onSend, onAbort, disabled, isThinking }) => {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!isThinking && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isThinking]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for new line
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    // Auto-resize
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
  };

  return (
    <div className="input-box-wrapper">
      <div className="input-box">
        <textarea
          ref={textareaRef}
          className="chat-textarea"
          value={value}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder="Nhập tin nhắn... (Enter để gửi, Shift+Enter xuống dòng)"
          rows={1}
          disabled={disabled && !isThinking}
          spellCheck={false}
        />
        <div className="input-actions">
          {isThinking ? (
            <Tooltip title="Dừng tạo">
              <Button
                type="text"
                shape="circle"
                icon={<StopOutlined />}
                onClick={onAbort}
                className="abort-btn"
              />
            </Tooltip>
          ) : (
            <Tooltip title="Gửi (Enter)">
              <Button
                type="text"
                shape="circle"
                icon={<SendOutlined />}
                onClick={handleSend}
                disabled={!value.trim() || disabled}
                className="send-btn"
              />
            </Tooltip>
          )}
        </div>
      </div>
      <div className="input-hint">
        Gõ tiếng Việt thoải mái • Enter gửi • Shift+Enter xuống dòng
      </div>
    </div>
  );
};

export default InputBox;
