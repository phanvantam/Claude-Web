import React, { useState } from 'react';
import {
  CaretRightOutlined,
  CaretDownOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  FileTextOutlined,
  EditOutlined,
  CodeOutlined,
  SearchOutlined,
  FolderOutlined,
  GlobalOutlined,
  FormOutlined,
  ThunderboltOutlined,
  ExportOutlined,
  QuestionCircleOutlined,
  ToolOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { ToolCall } from '../../types';

interface ToolCallCardProps {
  toolCall: ToolCall;
  /**
   * true khi tool block thuộc message đã finalized (không phải streaming).
   * Tool không có result trong message đã finalized → coi như đã hoàn thành,
   * vì SDK trả tool_result trong message riêng, không gắn vào tool_use block.
   */
  isFinalized?: boolean;
}

/** Icon tương ứng cho từng tool */
const getToolIcon = (name: string) => {
  switch (name) {
    case 'Read': return <FileTextOutlined />;
    case 'Edit':
    case 'Write': return <EditOutlined />;
    case 'Bash': return <CodeOutlined />;
    case 'Grep': return <SearchOutlined />;
    case 'Glob': return <FolderOutlined />;
    case 'WebSearch':
    case 'WebFetch': return <GlobalOutlined />;
    case 'TodoWrite':
    case 'NotebookEdit': return <FormOutlined />;
    case 'Task':
    case 'Agent': return <ThunderboltOutlined />;
    case 'TaskOutput': return <ExportOutlined />;
    case 'AskUserQuestion': return <QuestionCircleOutlined />;
    default: return <ToolOutlined />;
  }
};

/** Tóm tắt input tool — hiện trên header */
const getToolSummary = (toolCall: ToolCall): string => {
  const input = toolCall.input;
  const name = toolCall.name;
  switch (name) {
    case 'Read':
      return `${input.file_path || input.filePath || ''}${input.start_line ? ` (lines ${input.start_line}-${input.end_line || '...'})` : ''}`;
    case 'Write':
    case 'Edit':
      return `${input.file_path || input.filePath || ''}`;
    case 'Bash':
      return `${(input.command as string || '').slice(0, 80)}`;
    case 'Grep':
      return `pattern: "${input.pattern || input.query || ''}"`;
    case 'Glob':
      return `pattern: "${input.pattern || ''}"`;
    case 'WebSearch':
      return `${input.query || ''}`;
    case 'TodoWrite':
      return 'Update Todos';
    case 'AskUserQuestion': {
      // Trích xuất text câu hỏi từ input.questions[]  hoặc input.question
      const questions = input.questions as Array<{ question?: string }> | undefined;
      if (questions && Array.isArray(questions) && questions.length > 0) {
        return questions[0].question || 'Câu hỏi từ Claude';
      }
      return String(input.question || 'Câu hỏi từ Claude');
    }
    case 'Agent':
    case 'Task': {
      // Sub-agent — hiện type + description
      const agentType = input.subagent_type || input.agent_type || input.type || '';
      const desc = input.description || '';
      return [agentType, desc].filter(Boolean).join(': ') || 'Sub Agent';
    }
    default:
      return Object.keys(input).length > 0
        ? Object.entries(input).slice(0, 2).map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`).join(', ')
        : '';
  }
};

/** Trạng thái icon cho todo item */
const getTodoStatusIcon = (status: string) => {
  switch (status) {
    case 'completed':
      return <CheckCircleOutlined style={{ color: '#51cf66', fontSize: 13 }} />;
    case 'in_progress':
      return <LoadingOutlined style={{ color: '#e17055', fontSize: 13 }} spin />;
    default: // pending
      return <span className="todo-pending-dot" />;
  }
};

/** Render checklist cho TodoWrite — thay thế JSON thô */
const TodoChecklist: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const todos = (input.todos || input.items || []) as Array<{
    content?: string;
    activeForm?: string;
    status?: string;
  }>;

  if (!Array.isArray(todos) || todos.length === 0) {
    return <pre className="tl-tool-json">{JSON.stringify(input, null, 2)}</pre>;
  }

  return (
    <div className="todo-checklist">
      {todos.map((todo, i) => (
        <div
          key={i}
          className={`todo-item ${todo.status === 'completed' ? 'done' : ''} ${todo.status === 'in_progress' ? 'active' : ''}`}
        >
          <span className="todo-status-icon">{getTodoStatusIcon(todo.status || 'pending')}</span>
          <span className="todo-content">
            {todo.status === 'in_progress' && todo.activeForm
              ? todo.activeForm
              : todo.content || ''}
          </span>
        </div>
      ))}
    </div>
  );
};

const ToolCallCard: React.FC<ToolCallCardProps> = ({ toolCall, isFinalized = false }) => {
  const hasResult = toolCall.result !== undefined;
  // Tool đã hoàn thành nếu có explicit result, HOẶC nếu message đã finalized
  // (SDK trả tool_result trong message riêng — không gắn vào block này)
  const isDone = hasResult || isFinalized;
  const isError = toolCall.isError;
  const isRunning = !isDone;
  const isTodoWrite = toolCall.name === 'TodoWrite';

  // TodoWrite: mặc định mở — hiệu quả hơn vì user muốn thấy checklist ngay
  const [expanded, setExpanded] = useState(isTodoWrite);
  const summary = getToolSummary(toolCall);

  return (
    <div className={`tl-tool-item ${isRunning ? 'tl-tool-running' : ''}`}>
      <div className="tl-tool-header" onClick={() => setExpanded(!expanded)}>
        <span className="tl-tool-icon">{getToolIcon(toolCall.name)}</span>
        <span className="tl-tool-name">{toolCall.name}</span>
        {summary && <span className="tl-tool-summary">{summary}</span>}
        <span className="tl-tool-status">
          {isDone ? (
            isError
              ? <CloseCircleOutlined style={{ color: '#ff6b6b', fontSize: 12 }} />
              : <CheckCircleOutlined style={{ color: '#51cf66', fontSize: 12 }} />
          ) : (
            <LoadingOutlined style={{ color: '#e17055', fontSize: 12 }} spin />
          )}
        </span>
        <span className="tl-tool-toggle">
          {expanded ? <CaretDownOutlined /> : <CaretRightOutlined />}
        </span>
      </div>
      {expanded && (
        <div className="tl-tool-details">
          <div className="tl-tool-section">
            {isTodoWrite ? (
              <TodoChecklist input={toolCall.input} />
            ) : (
              <>
                <span className="tl-tool-label">INPUT</span>
                <pre className="tl-tool-json">{JSON.stringify(toolCall.input, null, 2)}</pre>
              </>
            )}
          </div>
          {toolCall.result !== undefined && (
            <div className="tl-tool-section">
              <span className={`tl-tool-label ${isError ? 'error' : 'success'}`}>
                {isError ? 'ERROR' : 'RESULT'}
              </span>
              <pre className="tl-tool-json">{toolCall.result}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCallCard;
