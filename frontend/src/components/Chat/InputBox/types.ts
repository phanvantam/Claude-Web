import type { PendingPermission, PendingAskUser } from '../../../hooks/useChat';
import type { TodoList } from '../../../types';

export type AgentInfo = {
  name: string;
  filename: string;
  description: string;
  scope?: 'user' | 'project' | 'local';
  model?: string;
  tools?: string[];
};

export interface InputBoxProps {
  onSend: (message: string) => void;
  disabled: boolean;
  isThinking: boolean;
  currentModel?: string;
  onModelChange?: (model: string) => void;
  onAbort?: () => void;
  effortLevel?: string;
  onEffortChange?: (level?: string) => void;
  permissionMode?: string;
  onPermissionModeChange?: (mode?: string) => void;
  pendingPermission?: PendingPermission | null;
  onRespondPermission?: (allowed: boolean) => void;
  pendingAskUser?: PendingAskUser | null;
  onRespondAskUser?: (answer: string) => void;
  projectId?: string;
  /** Multi-list todo lists (append-only, each with label + items) */
  todoLists?: TodoList[];
  /** Xóa một todo list khỏi danh sách */
  onRemoveTodoList?: (listId: string) => void;
}
