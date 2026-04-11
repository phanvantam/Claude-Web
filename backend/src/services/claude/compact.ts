import { v4 as uuidv4 } from 'uuid';
import { ChatMessage } from '../../types';
import { getProject } from '../project';
import { getSession, createSession, addMessage } from '../session';
import { logger } from '../logger';
import { ClaudeSessionState } from './types';
import * as utils from './utils';

/**
 * Nén context hội thoại (compact).
 * Flow: Gọi SDK tóm tắt hội thoại hiện tại → tạo session mới → chèn bản tóm tắt.
 * Trả về sessionId mới nếu thành công, throw nếu thất bại.
 */
export async function compactSession(
  sessionId: string,
  sessions: Map<string, ClaudeSessionState>,
): Promise<string> {
  const state = sessions.get(sessionId);
  if (!state) {
    // Thử load từ DB
    const saved = getSession(sessionId);
    if (!saved || saved.messages.length === 0) {
      throw new Error('Không tìm thấy session hoặc session trống.');
    }
    return compactFromMessages(saved.messages, saved.projectId || '', sessionId, sessions);
  }

  if (state.isProcessing) {
    throw new Error('Session đang xử lý, hãy đợi hoàn thành.');
  }

  if (state.messages.length < 2) {
    throw new Error('Hội thoại quá ngắn để nén.');
  }

  return compactFromMessages(state.messages, state.projectId, sessionId, sessions);
}

/**
 * Thực hiện compact: gọi SDK tóm tắt → tạo session mới.
 */
async function compactFromMessages(
  msgs: ChatMessage[],
  projectId: string,
  oldSessionId: string,
  sessions: Map<string, ClaudeSessionState>,
): Promise<string> {
  const project = getProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  // Build conversation text để gửi cho Claude tóm tắt
  const conversationText = msgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `[${m.role}]: ${m.content || '(no text)'}`)
    .join('\n\n');

  // Giới hạn text gửi đi — tránh quá dài
  const maxChars = 50000;
  const truncatedText = conversationText.length > maxChars
    ? conversationText.slice(-maxChars) + '\n\n(... phần đầu đã bị cắt bớt)'
    : conversationText;

  const summaryPrompt = `Hãy tóm tắt ngắn gọn cuộc hội thoại sau thành một bản tóm lược context. Chỉ giữ lại thông tin quan trọng: quyết định đã đưa ra, code đã thay đổi, vấn đề đang giải quyết, và bất kỳ context nào cần thiết để tiếp tục cuộc hội thoại. Viết dưới dạng bullet points ngắn gọn, bằng ngôn ngữ gốc của cuộc hội thoại.\n\n---\n${truncatedText}\n---\n\nTóm tắt:`;

  logger.info(`[Claude][compact] Summarizing ${msgs.length} messages for session ${oldSessionId}`);

  const sdk = await utils.getSDK();

  // Gọi SDK query đơn giản — không resume, không canUseTool, session tạm
  const options: Record<string, any> = {
    cwd: project.path,
    permissionMode: 'plan', // Plan mode — không cần permission
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    settingSources: ['project', 'user', 'local'],
  };

  let summaryText = '';

  try {
    const queryResult = sdk.query({ prompt: summaryPrompt, options });

    for await (const sdkMsg of queryResult) {
      const type = sdkMsg.type as string;
      if (type === 'assistant') {
        const apiMsg = sdkMsg.message;
        if (apiMsg?.content) {
          for (const block of apiMsg.content) {
            if (block.type === 'text' && block.text) {
              summaryText += block.text;
            }
          }
        }
      }
      // Bỏ qua các event khác (system, result, ...)
    }
  } catch (err: any) {
    logger.error(`[Claude][compact] SDK query error:`, err);
    throw new Error('Không thể tóm tắt hội thoại: ' + (err.message || String(err)));
  }

  if (!summaryText.trim()) {
    throw new Error('Claude không trả về bản tóm tắt.');
  }

  logger.info(`[Claude][compact] Summary generated: ${summaryText.length} chars`);

  // Tạo session mới
  const newSessionId = uuidv4();
  createSession({
    id: newSessionId,
    projectId,
    sessionId: newSessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isActive: true,
    name: `(compact) ${sessions.get(oldSessionId)?.sessionName || 'Hội thoại nén'}`,
  });

  // Chèn bản tóm tắt làm system message đầu tiên
  const contextMsg: ChatMessage = {
    id: `compact-${Date.now()}`,
    role: 'system',
    content: `📋 **Bản tóm tắt từ phiên trước:**\n\n${summaryText}`,
    timestamp: new Date().toISOString(),
  };
  addMessage(newSessionId, contextMsg);

  // Khởi tạo state cho session mới trong memory
  const oldState = sessions.get(oldSessionId);
  const newState: ClaudeSessionState = {
    sessionId: newSessionId,
    projectId,
    isProcessing: false,
    messages: [contextMsg],
    model: oldState?.model,
    effortLevel: oldState?.effortLevel,
    permissionMode: oldState?.permissionMode,
    sessionName: `(compact) ${oldState?.sessionName || 'Hội thoại nén'}`,
  };
  sessions.set(newSessionId, newState);

  // Cập nhật activeSessionId cho project
  try {
    const projectService = require('../project');
    projectService.updateProject(projectId, { activeSessionId: newSessionId });
  } catch {}

  logger.info(`[Claude][compact] Created new session ${newSessionId} from ${oldSessionId}`);
  return newSessionId;
}
