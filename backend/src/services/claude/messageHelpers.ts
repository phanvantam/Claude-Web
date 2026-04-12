import { EventEmitter } from 'events';
import { ChatMessage } from '../../types';
import { addMessage, updateMessageMeta } from '../session';
import { logger } from '../logger';
import { ClaudeSessionState } from './types';

/**
 * Persist message vào DB với error handling — không crash flow nếu DB lỗi.
 * Wrapper quanh addMessage() để tránh exception làm hỏng luồng chính.
 */
export function persistMessage(sessionId: string, msg: ChatMessage): void {
  try {
    addMessage(sessionId, msg);
  } catch (err) {
    logger.error(`[ClaudeService] Lỗi khi lưu message ${msg.id}:`, err);
  }
}

/**
 * Finalize assistant message — thêm vào history, lưu DB, notify frontend.
 * Xử lý trùng lặp khi CLI emit cùng message id 2 lần:
 * - Nếu message mới có content/blocks dài hơn → update DB + emit.
 * - Nếu không → skip để tránh duplicate.
 */
export function finalizeAssistantMessage(
  sessionId: string,
  chatMsg: ChatMessage,
  state: ClaudeSessionState,
  emitter: EventEmitter,
): void {
  const existingIdx = state.messages.findIndex(m => m.id === chatMsg.id);

  if (existingIdx >= 0) {
    // Message đã tồn tại — chỉ update nếu content mới đầy đủ hơn
    const existing = state.messages[existingIdx];
    const newContentLen = chatMsg.content?.length || 0;
    const existingContentLen = existing.content?.length || 0;
    const newBlocksLen = chatMsg.blocks?.length || 0;
    const existingBlocksLen = existing.blocks?.length || 0;

    if (newContentLen > existingContentLen || newBlocksLen > existingBlocksLen) {
      logger.info(`[Claude] Updating existing message ${chatMsg.id}: content ${existingContentLen}→${newContentLen}, blocks ${existingBlocksLen}→${newBlocksLen}`);
      state.messages[existingIdx] = { ...existing, ...chatMsg };
      try {
        updateMessageMeta(sessionId, {
          id: chatMsg.id,
          model: chatMsg.model,
          cost: chatMsg.cost,
          durationMs: chatMsg.durationMs,
          tokens: chatMsg.tokens,
        });
        // Update content + blocks vào DB — đảm bảo reload không mất data
        const { default: db } = require('../db');
        db.prepare(`
          UPDATE chat_messages SET content = ?, blocks = ?, tool_calls = ? WHERE session_id = ? AND id = ?
        `).run(
          chatMsg.content,
          chatMsg.blocks ? JSON.stringify(chatMsg.blocks) : null,
          chatMsg.toolCalls ? JSON.stringify(chatMsg.toolCalls) : null,
          sessionId,
          chatMsg.id,
        );
      } catch (err) {
        logger.error(`[Claude] Error updating message content:`, err);
      }
      emitter.emit('message', { sessionId, message: state.messages[existingIdx] });
    } else {
      logger.warn(`[Claude] finalizeAssistantMessage: duplicate ${chatMsg.id} — skipping`);
    }
    return;
  }

  // Message hoàn toàn mới
  logger.info(`[Claude] Finalizing assistant message for ${sessionId}: id=${chatMsg.id}, contentLen=${chatMsg.content?.length || 0}, blocks=${chatMsg.blocks?.length || 0}`);

  try {
    state.messages.push(chatMsg);
    persistMessage(sessionId, chatMsg);
    emitter.emit('message', { sessionId, message: chatMsg });
  } catch (err) {
    logger.error(`[Claude] Error in finalizeAssistantMessage for ${sessionId}:`, err);
  }
}
