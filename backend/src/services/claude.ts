import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import type { ChatMessage, ToolCall, ContentBlock, ClaudeContentBlock } from '../types';
import { getConfig } from './config';
import { getProject } from './project';
import { getSession, saveSession } from './session';
import type { ChatSession } from '../types';

interface ClaudeProcess {
  sessionId: string;
  projectId: string;
  isProcessing: boolean;
  process: ChildProcess | null;
  buffer: string;
  messages: ChatMessage[];
  messageStopReceived: boolean;
  lastPartialMessage: ChatMessage | null;
}

class ClaudeService extends EventEmitter {
  private processes: Map<string, ClaudeProcess> = new Map();

  /**
   * Get the state of an active session
   */
  getSessionState(sessionId: string): { messages: ChatMessage[]; isProcessing: boolean } | null {
    let claudeProc = this.processes.get(sessionId);
    if (!claudeProc) {
       const saved = getSession(sessionId);
       if (saved) {
         return {
           messages: saved.messages,
           isProcessing: false,
         }
       }
       return null;
    }
    return {
      messages: claudeProc.messages,
      isProcessing: claudeProc.isProcessing,
    };
  }

  private syncSessionToFile(sessionId: string) {
    const claudeProc = this.processes.get(sessionId);
    if (!claudeProc) return;
    const saved = getSession(sessionId);
    if (saved) {
      saved.messages = claudeProc.messages;
      saveSession(saved);
    }
  }


  /**
   * Start a new Claude CLI session for a project.
   * Uses --print --input-format stream-json --output-format stream-json
   */
  async startSession(projectId: string, existingSessionId?: string): Promise<string> {
    console.log(`[ClaudeService] startSession: projectId=${projectId}, existingSessionId=${existingSessionId}`);
    const project = getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const sessionId = existingSessionId || uuidv4();
    console.log(`[ClaudeService] Using sessionId=${sessionId}`);

    // If session already exists in memory, return it
    if (this.processes.has(sessionId)) {
      console.log(`[ClaudeService] Session ${sessionId} found in memory`);
      return sessionId;
    }

    const savedSession = getSession(sessionId);
    if (savedSession) {
      console.log(`[ClaudeService] Session ${sessionId} loaded from disk with ${savedSession.messages.length} messages`);
    } else {
      console.log(`[ClaudeService] Session ${sessionId} not found on disk, creating new`);
    }

    const claudeProc: ClaudeProcess = {
      process: null,
      sessionId,
      projectId,
      isProcessing: false,
      buffer: '',
      messages: savedSession ? savedSession.messages : [],
      messageStopReceived: false,
      lastPartialMessage: null,
    };

    if (!savedSession) {
      const newSession: ChatSession = {
        id: sessionId,
        projectId,
        sessionId,
        messages: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isActive: true,
      };
      saveSession(newSession);
    }
    
    // Update project's active session
    if (project.activeSessionId !== sessionId) {
      try {
        const projectService = require('./project');
        projectService.updateProject(projectId, { activeSessionId: sessionId });
        console.log(`[ClaudeService] Updated project ${projectId} activeSessionId to ${sessionId}`);
      } catch (err) {
        console.error('[ClaudeService] Failed to update project activeSessionId:', err);
      }
    }

    this.processes.set(sessionId, claudeProc);
    // Remove duplicate emit — let index.ts handle it with state
    // this.emit('session:started', { sessionId }); 
    return sessionId;
  }

  /**
   * Send a user message to an active Claude session
   */
  sendMessage(sessionId: string, message: string): void {
    const claudeProc = this.processes.get(sessionId);
    if (!claudeProc) {
      throw new Error(`No active session: ${sessionId}`);
    }

    if (claudeProc.isProcessing) {
      throw new Error(`Session ${sessionId} is already processing`);
    }

    claudeProc.isProcessing = true;
    this.emit('status', { sessionId, status: 'thinking' });

    // Ensure user message is saved to internal state
    const chatMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    claudeProc.messages.push(chatMsg);
    this.syncSessionToFile(sessionId);

    const project = getProject(claudeProc.projectId);
    const config = getConfig();
    
    // We only use --session-id for the very first message
    // If we have more than 1 message (the one we just added), we use --resume
    // Note: Since we pushed the user message above, first message means length = 1
    const isFirstMessage = claudeProc.messages.length === 1;
    const args = this.buildArgs(sessionId, config, !isFirstMessage ? sessionId : undefined);

    console.log(`[Claude] Executing turn for ${sessionId}`);

    const proc = spawn('claude', args, {
      cwd: project!.path,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    claudeProc.process = proc;
    claudeProc.buffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      const raw = data.toString();
      console.log(`[Claude stdout] received ${raw.length} chars, has newline: ${raw.includes('\n')}`);
      this.handleOutput(sessionId, raw);
    });

    proc.stderr.on('data', (data: Buffer) => {
      console.error(`[Claude stderr][${sessionId}]`, data.toString());
      this.emit('error', { sessionId, error: data.toString() });
    });

    proc.on('close', (code) => {
      console.log(`[Claude] Turn ${sessionId} exited with code ${code}`);
      
      // Flush any remaining buffer without a newline
      if (claudeProc.buffer.trim()) {
        try {
          const parsed = JSON.parse(claudeProc.buffer.trim());
          this.processStreamEvent(sessionId, parsed);
        } catch (e) {
          console.warn(`[Claude] Non-JSON trailing output: ${claudeProc.buffer.substring(0, 200)}`);
        }
        claudeProc.buffer = '';
      }

      if (claudeProc.process === proc) {
          claudeProc.process = null;
      }
      claudeProc.isProcessing = false;
      this.emit('status', { sessionId, status: 'idle' });
    });

    proc.on('error', (err) => {
      console.error(`[Claude] Process error for ${sessionId}:`, err);
      this.emit('error', { sessionId, error: err.message });
      if (claudeProc.process === proc) {
          claudeProc.process = null;
      }
      claudeProc.isProcessing = false;
      this.emit('status', { sessionId, status: 'idle' });
    });

    proc.stdin.write(message, 'utf-8');
    proc.stdin.end();
  }

  /**
   * Abort the current request in a session
   */
  abortSession(sessionId: string): void {
    const claudeProc = this.processes.get(sessionId);
    if (claudeProc && claudeProc.process) {
      claudeProc.process.kill('SIGINT');
      claudeProc.process = null;
    }
  }

  /**
   * Stop and cleanup a session
   */
  stopSession(sessionId: string): void {
    const claudeProc = this.processes.get(sessionId);
    if (claudeProc) {
      if (claudeProc.process) claudeProc.process.kill('SIGTERM');
      this.processes.delete(sessionId);
      this.emit('session:ended', { sessionId });
    }
  }

  /**
   * Check if a session is active
   */
  isSessionActive(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.processes.keys());
  }

  /**
   * Get active session ID for a project
   */
  getActiveSessionForProject(projectId: string): string | null {
    for (const [sessionId, process] of this.processes.entries()) {
      if (process.projectId === projectId) {
        return sessionId;
      }
    }
    return null;
  }

  /**
   * Finalize an assistant message — add to history, persist, and notify frontend
   */
  private finalizeAssistantMessage(sessionId: string, chatMsg: ChatMessage): void {
    const claudeProc = this.processes.get(sessionId);
    if (!claudeProc) return;

    // Prevent double-finalize for the same message
    if (claudeProc.messages.find(m => m.id === chatMsg.id)) return;

    claudeProc.messages.push(chatMsg);
    claudeProc.isProcessing = false;
    // Keep messageStopReceived = true so late 'assistant' events are
    // recognized as duplicates rather than new partial messages.
    // It will be reset by 'message_start' of the next turn.
    claudeProc.lastPartialMessage = null;
    this.syncSessionToFile(sessionId);
    this.emit('message', { sessionId, message: chatMsg });
    this.emit('status', { sessionId, status: 'idle' });
  }

  /**
   * Build CLI arguments
   */
  private buildArgs(sessionId: string, config: ReturnType<typeof getConfig>, resumeSessionId?: string): string[] {
    const args: string[] = [
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ];

    if (resumeSessionId) {
      args.push('--resume', resumeSessionId);
    } else {
      args.push('--session-id', sessionId);
    }

    if (config.model) {
      args.push('--model', config.model);
    }

    if (config.maxBudgetUsd) {
      args.push('--max-budget-usd', config.maxBudgetUsd.toString());
    }

    if (config.permissionMode) {
      args.push('--permission-mode', config.permissionMode);
    }

    if (config.systemPrompt) {
      args.push('--system-prompt', config.systemPrompt);
    }

    if (config.customArgs && config.customArgs.length > 0) {
      args.push(...config.customArgs);
    }

    return args;
  }

  /**
   * Parse stream-json output from Claude CLI
   */
  private handleOutput(sessionId: string, rawData: string): void {
    const claudeProc = this.processes.get(sessionId);
    if (!claudeProc) return;

    // Accumulate buffer and process complete JSON lines
    claudeProc.buffer += rawData;
    const lines = claudeProc.buffer.split('\n');
    claudeProc.buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        this.processStreamEvent(sessionId, parsed);
      } catch (e) {
        // Not valid JSON, might be plain text output
        console.warn(`[Claude] Non-JSON output: ${trimmed.substring(0, 200)}`);
      }
    }
  }

  /**
   * Process a single stream-json event
   */
  private processStreamEvent(sessionId: string, event: Record<string, unknown>): void {
    const type = event.type as string;

    switch (type) {
      case 'system': {
        // System initialization message
        const sysSessionId = event.session_id as string;
        console.log(`[Claude] System init, session: ${sysSessionId}`);
        this.emit('system', { sessionId, data: event });
        break;
      }

      case 'assistant': {
        const claudeProc = this.processes.get(sessionId);
        if (!claudeProc) break;

        const message = event.message as Record<string, unknown>;
        if (!message) break;

        const content = message.content as ClaudeContentBlock[];
        const chatMsg = this.buildChatMessage(sessionId, content, message);

        if (claudeProc.messageStopReceived) {
          // FINAL assistant message — after message_stop
          this.finalizeAssistantMessage(sessionId, chatMsg);
        } else {
          // PARTIAL assistant message (from --include-partial-messages)
          // Save it so we can finalize later if no final event arrives
          claudeProc.lastPartialMessage = chatMsg;
          this.emit('stream:partial', { sessionId, blocks: chatMsg.blocks || [] });
        }
        break;
      }

      case 'content_block_start': {
        const contentBlock = event.content_block as Record<string, unknown> | undefined;
        if (contentBlock && contentBlock.type === 'tool_use') {
          // Emit tool start so frontend can render it incrementally
          const toolInfo: ToolCall = {
            id: (contentBlock.id as string) || uuidv4(),
            name: (contentBlock.name as string) || 'unknown',
            input: (contentBlock.input as Record<string, unknown>) || {},
          };
          this.emit('stream:tool', { sessionId, tool: toolInfo });
          this.emit('status', { sessionId, status: 'tool_use' });
        } else if (contentBlock && contentBlock.type === 'text') {
          // Text block starting — no action needed, deltas will follow
        }
        break;
      }

      case 'content_block_delta': {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta && delta.type === 'text_delta') {
          console.log(`[Claude] Emitting stream delta: ${delta.text?.toString().substring(0, 10)}...`);
          this.emit('stream', {
            sessionId,
            content: delta.text as string,
            messageId: `msg-${sessionId}-streaming`,
          });
        }
        // input_json_delta for tool input — not needed for UI
        break;
      }

      case 'content_block_stop': {
        // A content block finished streaming
        break;
      }

      case 'message_start': {
        // Beginning of a new message — reset tracking
        const claudeProc = this.processes.get(sessionId);
        if (claudeProc) {
          claudeProc.messageStopReceived = false;
        }
        this.emit('status', { sessionId, status: 'thinking' });
        break;
      }

      case 'message_delta': {
        // Message meta update (stop_reason, usage)
        break;
      }

      case 'message_stop': {
        // Message fully complete
        const claudeProc = this.processes.get(sessionId);
        if (claudeProc) {
          claudeProc.messageStopReceived = true;
          // If we have a saved partial message, finalize it now.
          // A final 'assistant' event may follow and will be handled there,
          // but if it doesn't arrive, we still have the message committed.
          if (claudeProc.lastPartialMessage) {
            this.finalizeAssistantMessage(sessionId, claudeProc.lastPartialMessage);
          }
        }
        break;
      }

      case 'result': {
        // Final result
        const result = event as Record<string, unknown>;
        const costUsd = (result.total_cost_usd as number) || (result.cost_usd as number) || 0;
        const durationMs = (result.duration_ms as number) || 0;

        // Only emit result message if there's actual info
        if (result.is_error) {
          const finalMsg: ChatMessage = {
            id: `result-${Date.now()}`,
            role: 'system',
            content: `Error: ${result.error || result.result || 'Unknown error'}`,
            timestamp: new Date().toISOString(),
          };
          const claudeProc = this.processes.get(sessionId);
          if (claudeProc) {
            claudeProc.messages.push(finalMsg);
            this.syncSessionToFile(sessionId);
          }
          this.emit('result', { sessionId, result: finalMsg, data: result });
        } else if (costUsd > 0 || durationMs > 1000) {
          const finalMsg: ChatMessage = {
            id: `result-${Date.now()}`,
            role: 'system',
            content: `Completed: ${(durationMs / 1000).toFixed(1)}s · $${costUsd.toFixed(4)}`,
            timestamp: new Date().toISOString(),
            cost: costUsd,
          };
          const claudeProc = this.processes.get(sessionId);
          if (claudeProc) {
            claudeProc.messages.push(finalMsg);
            this.syncSessionToFile(sessionId);
          }
          this.emit('result', { sessionId, result: finalMsg, data: result });
        }
        break;
      }

      default: {
        // Forward unknown events
        this.emit('raw', { sessionId, event });
        break;
      }
    }
  }

  /**
   * Build a ChatMessage from Claude's content blocks
   */
  private buildChatMessage(
    sessionId: string,
    content: ClaudeContentBlock[],
    message: Record<string, unknown>
  ): ChatMessage {
    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];
    const blocks: ContentBlock[] = [];

    if (content) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          textParts.push(block.text);
          blocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_use') {
          const tc: ToolCall = {
            id: block.id || uuidv4(),
            name: block.name || 'unknown',
            input: block.input || {},
          };
          toolCalls.push(tc);
          blocks.push({ type: 'tool_use', tool: tc });
        } else if (block.type === 'tool_result') {
          // Find matching tool call in blocks and add result
          const matchId = block.id;
          for (let i = blocks.length - 1; i >= 0; i--) {
            const b = blocks[i];
            if (b.type === 'tool_use' && (matchId ? b.tool.id === matchId : true)) {
              b.tool.result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
              b.tool.isError = block.is_error;
              break;
            }
          }
          // Also update in toolCalls for backward compat
          const lastTool = matchId
            ? toolCalls.find(t => t.id === matchId)
            : toolCalls[toolCalls.length - 1];
          if (lastTool) {
            lastTool.result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
            lastTool.isError = block.is_error;
          }
        }
      }
    }

    const usage = message.usage as Record<string, number> | undefined;

    return {
      id: (message.id as string) || `msg-${Date.now()}`,
      role: 'assistant',
      content: textParts.join('\n'),
      blocks: blocks.length > 0 ? blocks : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      timestamp: new Date().toISOString(),
      model: message.model as string,
      tokens: usage ? { input: usage.input_tokens, output: usage.output_tokens } : undefined,
    };
  }

  /**
   * Cleanup all sessions on shutdown
   */
  cleanup(): void {
    for (const [sessionId] of this.processes) {
      this.stopSession(sessionId);
    }
  }
}

export const claudeService = new ClaudeService();
