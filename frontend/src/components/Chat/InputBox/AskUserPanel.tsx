import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { CheckCircleOutlined, LeftOutlined, RightOutlined, QuestionCircleOutlined, CheckSquareOutlined, BorderOutlined, CheckCircleFilled, CloseCircleOutlined } from '@ant-design/icons';
import type { PendingAskUser, AskUserQuestionOption } from '../../../hooks/useChat';

const AskUserPanel: React.FC<{
  pendingAskUser: PendingAskUser;
  onRespond: (answer: string) => void;
}> = ({ pendingAskUser, onRespond }) => {
  const { questions } = pendingAskUser;
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string | string[]>>({});
  const [textAnswer, setTextAnswer] = useState('');

  const isMultiQuestion = questions.length > 1;
  const currentQ = questions[currentStep];
  const currentAnswer = answers[currentStep];

  const hasCurrentAnswer = useMemo(() => {
    if (currentQ.options) return currentAnswer !== undefined && currentAnswer !== '';
    return textAnswer.trim().length > 0;
  }, [currentQ, currentAnswer, textAnswer]);

  // Reset text answer when step changes in multi-question mode
  useEffect(() => {
    setTextAnswer('');
  }, [currentStep]);

  // Auto-focus textarea on step change
  useEffect(() => {
    const ta = document.querySelector('.ask-user-panel .ask-user-textarea') as HTMLTextAreaElement | null;
    if (ta) ta.focus();
  }, [currentStep]);

  const handleSingleSelect = useCallback((opt: AskUserQuestionOption) => {
    setAnswers(prev => ({ ...prev, [currentStep]: opt.label }));
  }, [currentStep]);

  const handleMultiSelect = useCallback((selected: string[]) => {
    setAnswers(prev => ({ ...prev, [currentStep]: selected }));
  }, [currentStep]);

  const handleSubmitAll = useCallback(() => {
    const formattedAnswers = questions.map((q, i) => {
      const ans = answers[i];
      const answerText = Array.isArray(ans) ? ans.join(', ') : (ans || '');
      return `${q.question}\n→ ${answerText}`;
    }).join('\n\n');

    onRespond(formattedAnswers);
  }, [questions, answers, onRespond]);

  const handleTextSubmit = useCallback(() => {
    if (!textAnswer.trim()) return;
    if (isMultiQuestion) {
      setAnswers(prev => ({ ...prev, [currentStep]: textAnswer.trim() }));
      setTextAnswer('');
      if (currentStep < questions.length - 1) {
        setCurrentStep(s => s + 1);
      } else {
        handleSubmitAll();
      }
    } else {
      onRespond(textAnswer.trim());
    }
  }, [textAnswer, isMultiQuestion, currentStep, questions.length, handleSubmitAll, onRespond]);

  const handleNext = useCallback(() => {
    if (currentStep < questions.length - 1) {
      setCurrentStep(s => s + 1);
    }
  }, [currentStep, questions.length]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(s => s - 1);
    }
  }, [currentStep]);

  // Render multi-question stepper
  const renderStepper = () => (
    <div className="ask-user-stepper">
      <div className="ask-user-stepper-progress">
        {questions.map((_, i) => (
          <div
            key={i}
            className={`ask-user-stepper-dot ${i === currentStep ? 'active' : i < currentStep ? 'done' : ''}`}
          >
            {i < currentStep ? '✓' : i + 1}
          </div>
        ))}
      </div>
      <span className="ask-user-stepper-label">
        Câu {currentStep + 1} / {questions.length}
      </span>
    </div>
  );

  // Render options list with selection state
  const renderOptions = () => {
    if (!currentQ.options) return null;
    const selectedVal = currentAnswer as string | undefined;
    const isMulti = currentQ.multiSelect === true;
    const selectedArr = (currentAnswer as string[]) || [];

    return (
      <div className={`ask-user-options ${isMulti ? 'multi' : 'single'}`}>
        {currentQ.options.map((opt) => {
          const isSelected = isMulti
            ? selectedArr.includes(opt.label)
            : selectedVal === opt.label;
          return (
            <button
              key={opt.label}
              className={`ask-user-option-btn ${isSelected ? 'selected' : ''}`}
              onClick={() => {
                if (isMulti) {
                  const next = isSelected
                    ? selectedArr.filter(l => l !== opt.label)
                    : [...selectedArr, opt.label];
                  handleMultiSelect(next);
                } else {
                  handleSingleSelect(opt);
                }
              }}
            >
              <div className="ask-user-option-check">
                {isMulti ? (
                  isSelected ? <CheckSquareOutlined className="check-icon checked" /> : <BorderOutlined className="check-icon" />
                ) : (
                  isSelected ? <CheckCircleFilled className="radio-icon selected" /> : <CloseCircleOutlined className="radio-icon" />
                )}
              </div>
              <div className="ask-user-option-content">
                <span className="ask-user-option-label">{opt.label}</span>
                {opt.description && <span className="ask-user-option-desc">{opt.description}</span>}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  // Render footer navigation
  const renderFooter = () => {
    const isLast = currentStep === questions.length - 1;

    return (
      <div className="ask-user-footer">
        {currentStep > 0 && (
          <button className="ask-user-footer-btn back" onClick={handleBack}>
            <LeftOutlined /> Quay lại
          </button>
        )}
        <div className="ask-user-footer-right">
          {isLast ? (
            <button
              className="permission-btn permission-btn-allow"
              disabled={!hasCurrentAnswer}
              onClick={handleSubmitAll}
            >
              <CheckCircleOutlined /> Gửi tất cả
            </button>
          ) : (
            <button
              className="ask-user-footer-btn next"
              disabled={!hasCurrentAnswer}
              onClick={handleNext}
            >
              Tiếp tục <RightOutlined />
            </button>
          )}
        </div>
      </div>
    );
  };

  // Single question — backward compatible
  if (!isMultiQuestion) {
    return (
      <div className="permission-panel ask-user-panel">
        {currentQ.header && (
          <div className="permission-panel-header">
            <QuestionCircleOutlined className="permission-panel-icon" />
            <span className="permission-panel-title">{currentQ.header}</span>
          </div>
        )}
        <div className="ask-user-question-text">{currentQ.question}</div>
        {currentQ.options && currentQ.options.length > 0 ? (
          <div className="ask-user-options">
            {currentQ.options.map((opt) => (
              <button
                key={opt.label}
                className="ask-user-option-btn"
                onClick={() => onRespond(opt.label)}
              >
                <span className="ask-user-option-label">{opt.label}</span>
                {opt.description && <span className="ask-user-option-desc">{opt.description}</span>}
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
              onClick={() => { onRespond(textAnswer.trim()); setTextAnswer(''); }}
            >
              <CheckCircleOutlined /> Gửi
            </button>
          </div>
        )}
      </div>
    );
  }

  // Multi-question stepper view
  return (
    <div className="permission-panel ask-user-panel">
      {currentQ.header && (
        <div className="permission-panel-header">
          <QuestionCircleOutlined className="permission-panel-icon" />
          <span className="permission-panel-title">{currentQ.header}</span>
        </div>
      )}
      {renderStepper()}
      <div className="ask-user-question-text">{currentQ.question}</div>
      {currentQ.options && currentQ.options.length > 0 ? (
        renderOptions()
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
                handleTextSubmit();
              }
            }}
          />
        </div>
      )}
      {renderFooter()}
    </div>
  );
};

export default AskUserPanel;
