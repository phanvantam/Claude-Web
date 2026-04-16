import React from 'react';
import { Typography, Tag, Tooltip } from 'antd';
import { EditOutlined, WarningOutlined } from '@ant-design/icons';

const { Text } = Typography;

/**
 * Tool-specific input renderers.
 * Mỗi tool family có renderer riêng thay vì JSON thô.
 * Dùng chung cho PermissionPanel (xác nhận quyền) và ToolCallCard (timeline).
 */

// ============================================================
// Helper: Row layout
// ============================================================
interface InputRowProps {
  label: string;
  value: React.ReactNode;
}

const InputRow: React.FC<InputRowProps> = ({ label, value }) => (
  <div className="tool-input-row">
    <span className="tool-input-label">{label}</span>
    <span className="tool-input-value">{value}</span>
  </div>
);

// ============================================================
// Tool Result Renderer (dùng chung cho tool_result trong timeline)
// ============================================================
interface ToolResultRendererProps {
  result?: string;
  toolName: string;
}

export const ToolResultRenderer: React.FC<ToolResultRendererProps> = ({
  result,
  toolName,
}) => {
  if (result == null) return null;

  // Tool result có thể là text thuần hoặc JSON
  const tryParse = (): Record<string, unknown> | null => {
    try {
      const p = JSON.parse(result);
      return typeof p === 'object' && p !== null ? p : null;
    } catch {
      return null;
    }
  };

  const parsed = tryParse();

  // Bash / command output — hiện dạng text đơn giản
  if (toolName === 'Bash' || toolName === 'TaskOutput') {
    if (parsed && !Array.isArray(parsed)) {
      // Output có cấu trúc { stdout, stderr, exitCode }
      return (
        <div className="tool-result">
          {parsed.stdout != null && (
            <div className="tool-input-row">
              <span className="tool-input-label">stdout</span>
              <pre className="tool-output-text">{String(parsed.stdout)}</pre>
            </div>
          )}
          {parsed.stderr != null && (
            <div className="tool-input-row">
              <span className="tool-input-label">stderr</span>
              <pre className="tool-output-text tool-output-stderr">{String(parsed.stderr)}</pre>
            </div>
          )}
          {parsed.exitCode != null && (
            <div className="tool-input-row">
              <span className="tool-input-label">exit</span>
              <Text type={Number(parsed.exitCode) === 0 ? 'success' : 'danger'}>
                {String(parsed.exitCode)}
              </Text>
            </div>
          )}
          {Object.keys(parsed).length === 0 && (
            <pre className="tool-output-text">{result}</pre>
          )}
        </div>
      );
    }
    return <pre className="tool-output-text">{result}</pre>;
  }

  // Read / Write / Edit — hiện số bytes / dòng
  if (['Read', 'Write', 'Edit'].includes(toolName)) {
    if (parsed) {
      return (
        <div className="tool-input-row">
          <span className="tool-input-label">Kết quả</span>
          <Text type="success">
            {parsed.bytes != null ? `${parsed.bytes} bytes`
              : parsed.lines != null ? `${parsed.lines} dòng`
              : result}
          </Text>
        </div>
      );
    }
    return <pre className="tool-output-text">{result.slice(0, 200)}{result.length > 200 ? '...' : ''}</pre>;
  }

  // Grep / Glob — show matches count
  if (['Grep', 'Glob'].includes(toolName)) {
    if (parsed) {
      const matchCount = Array.isArray(parsed.matches) ? (parsed.matches as unknown[]).length
        : Array.isArray(parsed.files) ? (parsed.files as unknown[]).length
        : Array.isArray(parsed.results) ? (parsed.results as unknown[]).length
        : 0;
      const totalRaw = parsed.total;
      const totalCount = totalRaw != null ? Number(totalRaw) : matchCount;
      return (
        <div className="tool-input-row">
          <span className="tool-input-label">Kết quả</span>
          <Text type={matchCount > 0 ? 'success' : 'secondary'}>
            {totalCount > 0 ? `${matchCount} kết quả${totalCount !== matchCount ? ` / ${totalCount} total` : ''}` : 'Không tìm thấy'}
          </Text>
        </div>
      );
    }
    return <pre className="tool-output-text">{result.slice(0, 200)}{result.length > 200 ? '...' : ''}</pre>;
  }

  // Generic — JSON dump
  if (parsed) {
    return (
      <pre className="tool-input-json tool-input-result">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  }

  // Plain text fallback
  return <pre className="tool-output-text">{result.slice(0, 500)}{result.length > 500 ? '\n...' : ''}</pre>;
};

// ============================================================
// Read Tool
// ============================================================
const ReadToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const filePath = String(input.file_path || input.filePath || input.path || '');
  const startLine = input.start_line ?? input.start ?? input.startLine;
  const endLine = input.end_line ?? input.end ?? input.endLine;
  const limit = input.limit;
  const offset = input.offset;

  return (
    <div className="tool-input-file">
      <InputRow label="File" value={<code className="tool-input-code">{filePath}</code>} />
      {startLine != null && (
        <InputRow label="Lines" value={`${startLine}${endLine != null ? ` – ${endLine}` : ' – …'}`} />
      )}
      {limit != null && (
        <InputRow label="Limit" value={String(limit)} />
      )}
      {offset != null && (
        <InputRow label="Offset" value={String(offset)} />
      )}
    </div>
  );
};

// ============================================================
// Write Tool
// ============================================================
const WriteToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const filePath = String(input.file_path || input.filePath || input.path || '');
  const content = input.content;
  const fileMode = input.fileMode ?? input.file_mode ?? input.mode;

  return (
    <div className="tool-input-file">
      <InputRow label="File" value={<code className="tool-input-code">{filePath}</code>} />
      {content != null && (
        <InputRow label="Content" value={
          <span className="tool-input-preview">
            {String(content).slice(0, 120)}{String(content).length > 120 ? '…' : ''}
          </span>
        } />
      )}
      {fileMode != null && (
        <InputRow label="Mode" value={<code>{String(fileMode)}</code>} />
      )}
    </div>
  );
};

// ============================================================
// Edit Tool
// ============================================================
const EditToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const filePath = String(input.file_path || input.filePath || input.path || '');
  const oldString = input.old_string ?? input.oldString ?? input.old_string ?? input.find ?? input.oldStr;
  const newString = input.new_string ?? input.newString ?? input.newStr ?? input.replace;
  const partialDiff = input.partialDiff ?? input.partial_diff;

  return (
    <div className="tool-input-file tool-input-edit">
      <InputRow label="File" value={<code className="tool-input-code">{filePath}</code>} />
      {oldString != null && (
        <div className="tool-input-row tool-input-edit-row">
          <span className="tool-input-label">Tìm</span>
          <pre className="tool-input-diff">{(String(oldString)).slice(0, 120)}</pre>
        </div>
      )}
      {newString != null && (
        <div className="tool-input-row tool-input-edit-row">
          <span className="tool-input-label">Thay bằng</span>
          <pre className="tool-input-diff tool-input-diff-new">{(String(newString)).slice(0, 120)}</pre>
        </div>
      )}
      {partialDiff != null && (
        <Tooltip title="Partial diff">
          <Tag color="blue" style={{ fontSize: 10 }}><EditOutlined /> partial</Tag>
        </Tooltip>
      )}
    </div>
  );
};

// ============================================================
// Bash Tool
// ============================================================
const BashToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const command = String(input.command || input.cmd || '');
  const timeout = input.timeout;
  const runInBackground = Boolean(input.run_in_background || input.runInBackground);
  const dangerouslyDisableSandbox = Boolean(input.dangerouslyDisableSandbox);
  const cwd = input.cwd ? String(input.cwd) : '';

  return (
    <div className="tool-input-bash">
      <div className="tool-input-row tool-input-command-row">
        <span className="tool-input-label">Command</span>
        <code className="tool-input-code tool-input-command">{command}</code>
      </div>
      {cwd && (
        <InputRow label="CWD" value={<code className="tool-input-value">{cwd}</code>} />
      )}
      {timeout != null && (
        <InputRow label="Timeout" value={`${String(timeout)}ms`} />
      )}
      {runInBackground && (
        <InputRow label="Background" value={<Tag color="purple" style={{ fontSize: 10 }}>Yes</Tag>} />
      )}
      {dangerouslyDisableSandbox && (
        <InputRow label="Sandbox" value={
          <Tooltip title="Shell sandbox đã bị vô hiệu hóa">
            <Tag color="red" style={{ fontSize: 10 }} icon={<WarningOutlined />}>Disabled</Tag>
          </Tooltip>
        } />
      )}
    </div>
  );
};

// ============================================================
// Grep Tool
// ============================================================
const GrepToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const pattern = String(input.pattern || input.query || input.search || '');
  const path = input.path ? String(input.path) : '';
  const glob = input.glob ? String(input.glob) : '';
  const context = input.context;
  const caseSensitive = input.case_sensitive ?? input.caseSensitive ?? input.ignoreCase === false;
  const isRegex = input.isRegex ?? input.is_regex ?? input.regex ?? false;
  const maxResults = input.max_results ?? input.maxResults ?? input.limit;

  return (
    <div className="tool-input-search">
      <InputRow label="Pattern" value={<code className="tool-input-value">{pattern}</code>} />
      {path && <InputRow label="Path" value={<code className="tool-input-value">{path}</code>} />}
      {glob && <InputRow label="Glob" value={<code className="tool-input-value">{glob}</code>} />}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {isRegex && <Tag color="purple" style={{ fontSize: 10 }}>regex</Tag>}
        {caseSensitive && <Tag color="orange" style={{ fontSize: 10 }}>case-sensitive</Tag>}
        {context != null && <Tag color="blue" style={{ fontSize: 10 }}>context: {String(context)}</Tag>}
        {maxResults != null && <Tag color="cyan" style={{ fontSize: 10 }}>limit: {String(maxResults)}</Tag>}
      </div>
    </div>
  );
};

// ============================================================
// Glob Tool
// ============================================================
const GlobToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const pattern = String(input.pattern || input.glob || '');
  const path = input.path ? String(input.path) : '';
  const fileMode = input.fileMode ?? input.file_mode;

  return (
    <div className="tool-input-search">
      <InputRow label="Pattern" value={<code className="tool-input-value">{pattern}</code>} />
      {path && <InputRow label="Path" value={<code className="tool-input-value">{path}</code>} />}
      {fileMode != null && <InputRow label="Mode" value={String(fileMode)} />}
    </div>
  );
};

// ============================================================
// WebSearch / WebFetch Tool
// ============================================================
const WebToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const query = String(input.query || input.url || input.pattern || '');
  const maxResults = input.max_results ?? input.maxResults;
  const source = input.source ? String(input.source) : '';
  const recencyDays = input.recency_days ?? input.recencyDays;

  return (
    <div className="tool-input-search tool-input-web">
      <InputRow label="Query" value={<code className="tool-input-code">{query}</code>} />
      {maxResults != null && (
        <InputRow label="Results" value={String(maxResults)} />
      )}
      {source && (
        <InputRow label="Source" value={<code className="tool-input-value">{source}</code>} />
      )}
      {recencyDays != null && (
        <InputRow label="Recency" value={`${String(recencyDays)} days`} />
      )}
    </div>
  );
};

// ============================================================
// TodoWrite Tool (minimal — full render bởi TodoChecklist trong ToolCallCard)
// ============================================================
const TodoWriteToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const todos = (input.todos || input.items || []) as Array<{
    content?: string;
    activeForm?: string;
    status?: string;
  }>;
  const count = Array.isArray(todos) ? todos.length : 0;
  const completed = Array.isArray(todos) ? todos.filter(t => t.status === 'completed').length : 0;

  return (
    <div className="tool-input-search">
      <InputRow label="Todos" value={
        <span>
          <Text type="success">{count}</Text>
          {completed > 0 && <Text type="secondary" style={{ fontSize: 11 }}> ({completed} done)</Text>}
        </span>
      } />
    </div>
  );
};

// ============================================================
// TaskOutput Tool
// ============================================================
const TaskOutputToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const taskId = input.taskId ?? input.task_id ?? input.task ?? '';
  const action = input.action ?? 'get';

  return (
    <div className="tool-input-search">
      <InputRow label="Task" value={<code className="tool-input-value">{String(taskId)}</code>} />
      <InputRow label="Action" value={<Tag style={{ fontSize: 10 }}>{String(action)}</Tag>} />
    </div>
  );
};

// ============================================================
// NotebookEdit Tool
// ============================================================
const NotebookEditToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const notebookPath = String(input.notebook_path || input.notebookPath || input.path || '');
  const cellIndex = input.cell_index ?? input.cellIndex ?? input.cell;
  const cellId = input.cell_id ?? input.cellId;
  const editType = input.edit_type ?? input.editType ?? input.type;

  return (
    <div className="tool-input-file">
      <InputRow label="Notebook" value={<code className="tool-input-code">{notebookPath}</code>} />
      {cellIndex != null && (
        <InputRow label="Cell" value={String(cellIndex)} />
      )}
      {cellId != null && (
        <InputRow label="Cell ID" value={<code>{String(cellId)}</code>} />
      )}
      {editType != null && (
        <InputRow label="Type" value={<Tag style={{ fontSize: 10 }}>{String(editType)}</Tag>} />
      )}
    </div>
  );
};

// ============================================================
// MCP Tool (generic but structured)
// ============================================================
const MCPToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const entries = Object.entries(input);

  return (
    <div className="tool-input-search tool-input-mcp">
      {entries.length === 0 ? (
        <InputRow label="Params" value={<Text type="secondary">không có tham số</Text>} />
      ) : (
        entries.map(([key, val]) => (
          <InputRow
            key={key}
            label={key}
            value={
              typeof val === 'object' && val !== null
                ? <code className="tool-input-value">{JSON.stringify(val).slice(0, 60)}</code>
                : <code className="tool-input-value">{String(val)}</code>
            }
          />
        ))
      )}
    </div>
  );
};

// ============================================================
// Generic Fallback
// ============================================================
const GenericToolInput: React.FC<{ input: Record<string, unknown> }> = ({ input }) => {
  const entries = Object.entries(input);

  if (entries.length === 0) {
    return (
      <div className="tool-input-row">
        <Text type="secondary" style={{ fontSize: 12 }}>không có input</Text>
      </div>
    );
  }

  return (
    <div className="tool-input-generic">
      {entries.map(([key, val]) => (
        <InputRow
          key={key}
          label={key}
          value={
            typeof val === 'object' && val !== null
              ? <code className="tool-input-value">{JSON.stringify(val).slice(0, 80)}</code>
              : <code className="tool-input-value">{String(val)}</code>
          }
        />
      ))}
    </div>
  );
};

// ============================================================
// Dispatcher
// ============================================================
export function renderToolInput(
  toolName: string,
  input: Record<string, unknown>,
): React.ReactNode {
  const name = toolName;

  if (name === 'Read') return <ReadToolInput input={input} />;
  if (name === 'Write') return <WriteToolInput input={input} />;
  if (name === 'Edit') return <EditToolInput input={input} />;
  if (name === 'NotebookEdit') return <NotebookEditToolInput input={input} />;
  if (name === 'Bash') return <BashToolInput input={input} />;
  if (name === 'Grep') return <GrepToolInput input={input} />;
  if (name === 'Glob') return <GlobToolInput input={input} />;
  if (name === 'WebSearch' || name === 'WebFetch') return <WebToolInput input={input} />;
  if (name === 'TodoWrite') return <TodoWriteToolInput input={input} />;
  if (name === 'TaskOutput') return <TaskOutputToolInput input={input} />;
  if (name.startsWith('mcp__')) return <MCPToolInput input={input} />;
  if (['Agent', 'Task', 'AskUserQuestion', 'Agent', 'Task'].includes(name)) return null;

  return <GenericToolInput input={input} />;
}

export default renderToolInput;
