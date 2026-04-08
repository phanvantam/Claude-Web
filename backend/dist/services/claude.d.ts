import { EventEmitter } from 'events';
import type { ChatMessage } from '../types';
declare class ClaudeService extends EventEmitter {
    private processes;
    /**
     * Get the state of an active session
     */
    getSessionState(sessionId: string): {
        messages: ChatMessage[];
        isProcessing: boolean;
    } | null;
    private syncSessionToFile;
    /**
     * Start a new Claude CLI session for a project.
     * Uses --print --input-format stream-json --output-format stream-json
     */
    startSession(projectId: string, existingSessionId?: string): Promise<string>;
    /**
     * Send a user message to an active Claude session
     */
    sendMessage(sessionId: string, message: string): void;
    /**
     * Abort the current request in a session
     */
    abortSession(sessionId: string): void;
    /**
     * Stop and cleanup a session
     */
    stopSession(sessionId: string): void;
    /**
     * Check if a session is active
     */
    isSessionActive(sessionId: string): boolean;
    /**
     * Get all active sessions
     */
    getActiveSessions(): string[];
    /**
     * Get active session ID for a project
     */
    getActiveSessionForProject(projectId: string): string | null;
    /**
     * Finalize an assistant message — add to history, persist, and notify frontend
     */
    private finalizeAssistantMessage;
    /**
     * Build CLI arguments
     */
    private buildArgs;
    /**
     * Parse stream-json output from Claude CLI
     */
    private handleOutput;
    private tryParseAndProcess;
    /**
     * Process a single stream-json event
     */
    private processStreamEvent;
    /**
     * Build a ChatMessage from Claude's content blocks
     */
    private buildChatMessage;
    /**
     * Cleanup all sessions on shutdown
     */
    cleanup(): void;
}
export declare const claudeService: ClaudeService;
export {};
//# sourceMappingURL=claude.d.ts.map