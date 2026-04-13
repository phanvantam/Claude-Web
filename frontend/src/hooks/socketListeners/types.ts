/**
 * Types dùng chung giữa các handler trong useChatSocketListeners.
 *
 * Tách ra để tránh circular dependency khi split handlers thành file riêng.
 */

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { ChatMessage, ContentBlock } from '../../types';
import type {
  PendingPermission,
  PendingAskUser,
  McpRuntimeServer,
} from '../useChat';

export type ChatStatus = 'idle' | 'initializing' | 'thinking' | 'tool_use';

export type ActiveSubAgent = {
  name: string;
  prompt: string;
  lastHeartbeat?: number;
  activities?: Array<{ toolName: string; inputSummary?: string; timestamp: number }>;
  currentToolName?: string;
};

export interface SessionStartedState {
  messages: ChatMessage[];
  isProcessing: boolean;
  model?: string;
  effortLevel?: string;
  permissionMode?: string;
  pendingPermission?: PendingPermission;
  processingStartedAt?: number;
  activeToolName?: string;
  activeSubAgent?: ActiveSubAgent;
  partialAssistantBlocks?: ContentBlock[];
  partialAssistantContent?: string;
}

/** Tập hợp đầy đủ các setter + ref mà socket handlers cần truy cập */
export interface SocketHandlerDeps {
  setIsConnected: Dispatch<SetStateAction<boolean>>;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setStreamingBlocks: Dispatch<SetStateAction<ContentBlock[]>>;
  setStatus: Dispatch<SetStateAction<ChatStatus>>;
  setActiveToolName: Dispatch<SetStateAction<string | null>>;
  setProcessingStartedAt: Dispatch<SetStateAction<number | null>>;
  setSessionId: Dispatch<SetStateAction<string | null>>;
  setHasMoreMessages: Dispatch<SetStateAction<boolean>>;
  setSessionModel: Dispatch<SetStateAction<string | undefined>>;
  setSessionEffortLevelState: Dispatch<SetStateAction<string | undefined>>;
  setSessionPermissionModeState: Dispatch<SetStateAction<string | undefined>>;
  setPendingPermission: Dispatch<SetStateAction<PendingPermission | null>>;
  setIsSwitchingSession: Dispatch<SetStateAction<boolean>>;
  setActiveSubAgent: Dispatch<SetStateAction<ActiveSubAgent | null>>;
  setPendingAskUser: Dispatch<SetStateAction<PendingAskUser | null>>;
  setMcpRuntimeStatus: Dispatch<SetStateAction<McpRuntimeServer[]>>;
  streamingRef: MutableRefObject<string>;
  sessionIdRef: MutableRefObject<string | null>;
  pendingSessionIdRef: MutableRefObject<string | null>;
  nextCursorRef: MutableRefObject<number | null>;
  knownMessageIdsRef: MutableRefObject<Set<string>>;
  idleTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  restoringSessionIdRef: MutableRefObject<string | null>;
  idleDuringRestoreRef: MutableRefObject<boolean>;
  switchTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}
