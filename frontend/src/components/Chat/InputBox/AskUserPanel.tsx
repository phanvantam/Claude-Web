import React, { useState } from 'react';
import { CheckCircleOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { PendingAskUser } from '../../../hooks/useChat';

const AskUserPanel: React.FC<{
  pendingAskUser: PendingAskUser;
  onRespond: (answer: string) => void;
}> = ({ pendingAskUser, onRespond }) => {
  const [textAnswer, setTextAnswer] = useState('');
  const { questions } = pendingAskUser;

  return (
    <div className="permission-panel ask-user-panel">
      {questions.map((q, qi) => (
        <div key={qi} className="ask-user-question-block">
          {q.header && (
            <div className="permission-panel-header">
              <QuestionCircleOutlined className="permission-panel-icon" />
              <span className="permission-panel-title">{q.header}</span>
            </div>
          )}
          <div className="ask-user-question-text">{q.question}</div>

          {q.options && q.options.length > 0 ? (
            <div className="ask-user-options">
              {q.options.map((opt, oi) => (
                <button
                  key={oi}
                  className="ask-user-option-btn"
                  onClick={() => onRespond(opt.label)}
                >
                  <span className="ask-user-option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="ask-user-option-desc">{opt.description}</span>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="ask-user-text-input">
              <textarea
                className="ask-user-textarea"
                value={textAnswer}
                onChange={(e) => setTextAnswer(e.target.value)}
                placeholder="Nhập câu trả lời..."
                rows={2}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && textAnswer.trim()) {
                    e.preventDefault();
                    onRespond(textAnswer.trim());
                    setTextAnswer('');
                  }
                }}
              />
              <button
                className="permission-btn permission-btn-allow"
                disabled={!textAnswer.trim()}
                onClick={() => {
                  if (textAnswer.trim()) {
                    onRespond(textAnswer.trim());
                    setTextAnswer('');
                  }
                }}
              >
                <CheckCircleOutlined /> Gửi
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default AskUserPanel;
