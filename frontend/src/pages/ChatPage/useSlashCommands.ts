/**
 * Hook xử lý slash commands và @mention agent trong ChatPage.
 *
 * Tách từ ChatPage.tsx — cô lập logic dispatch tin nhắn vs xử lý
 * cục bộ trên frontend (slash commands), giảm kích thước component chính.
 */

import { useCallback } from 'react';
import { message } from 'antd';
import type { SessionStats } from './StatsPopoverContent';

interface UseSlashCommandsParams {
  sessionId: string | null;
  projectId: string | undefined;
  configModel: string;
  sessionStats: SessionStats;
  messagesCount: number;
  effortLabel: string;
  permissionLabel: string;
  sendMessage: (text: string) => void;
  startSession: (projectId: string, sessionId?: string) => void;
  handleModelChange: (model: string) => void;
  addSystemMessage: (content: string) => void;
  compactSession: () => void;
}

/**
 * Trả về hàm handleSend xử lý cả slash commands và tin nhắn thường.
 *
 * Slash commands bắt đầu bằng '/' sẽ được chặn và xử lý cục bộ trên frontend
 * (không gửi qua SDK) để tránh Claude trả lời không mong muốn.
 * Commands không nhận ra sẽ forward cho SDK xử lý (custom/plugin commands).
 */
export function useSlashCommands({
  sessionId,
  projectId,
  configModel,
  sessionStats,
  messagesCount,
  effortLabel,
  permissionLabel,
  sendMessage,
  startSession,
  handleModelChange,
  addSystemMessage,
  compactSession,
}: UseSlashCommandsParams) {
  const handleSend = useCallback((text: string) => {
    if (!sessionId) {
      message.warning('Hãy bắt đầu phiên chat trước');
      return;
    }

    const trimmed = text.trim();

    // Không phải slash command → kiểm tra @mention agent rồi gửi
    if (!trimmed.startsWith('/')) {
      // Transform @agent-name thành SDK directive
      // Case 1: "@agent-name task text" → gọi agent với task cụ thể
      const mentionWithTask = trimmed.match(/^@([a-z0-9_-]+)\s+([\s\S]+)/i);
      if (mentionWithTask) {
        const [, agentName, task] = mentionWithTask;
        sendMessage(`Use the "${agentName}" subagent to: ${task}`);
        return;
      }
      // Case 2: "@agent-name" không có task → gọi agent với context hiện tại
      const mentionOnly = trimmed.match(/^@([a-z0-9_-]+)$/i);
      if (mentionOnly) {
        const agentName = mentionOnly[1];
        sendMessage(`Use the "${agentName}" subagent to: assist with the current context`);
        return;
      }
      sendMessage(trimmed);
      return;
    }

    // Tách lệnh và tham số
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/clear': {
        // Tạo session mới hoàn toàn
        if (projectId) {
          startSession(projectId);
          message.success('Bắt đầu cuộc hội thoại mới');
        }
        break;
      }

      case '/model': {
        if (args.length > 0) {
          handleModelChange(args[0]);
          addSystemMessage(`### Thay đổi Model\n\nĐã chuyển sang model: **${args[0]}**`);
        } else {
          addSystemMessage(`### Thông tin Model\n\n**Model hiện tại:** \`${configModel || '—'}\``);
        }
        break;
      }

      case '/cost': {
        const rows = [
          `| Thông tin | Giá trị |`,
          `| :--- | :--- |`,
          `| **Model** | \`${sessionStats.model || '—'}\` |`,
          `| **Tokens nhận** | ${sessionStats.inputTokens.toLocaleString('vi-VN')} |`,
          `| **Tokens gửi** | ${sessionStats.outputTokens.toLocaleString('vi-VN')} |`,
          `| **Tổng tokens** | **${sessionStats.totalTokens.toLocaleString('vi-VN')}** |`,
          `| **Chi phí** | **$${sessionStats.cost.toFixed(4)}** |`,
          `| **Lượt hỏi** | ${sessionStats.turns} |`,
        ];
        addSystemMessage(`### Thống kê phiên hiện tại\n\n${rows.join('\n')}`);
        break;
      }

      case '/status': {
        const statusRows = [
          `| Thuộc tính | Trạng thái |`,
          `| :--- | :--- |`,
          `| **Session ID** | \`${sessionId}\` |`,
          `| **Model** | \`${configModel || '—'}\` |`,
          `| **Nỗ lực** | \`${effortLabel}\` |`,
          `| **Quyền** | \`${permissionLabel}\` |`,
          `| **Tin nhắn** | ${messagesCount} |`,
        ];
        addSystemMessage(`### Trạng thái phiên\n\n${statusRows.join('\n')}`);
        break;
      }

      case '/help': {
        const helpLines = [
          `### Danh sách lệnh khả dụng`,
          ``,
          `- \`/clear\` — **Làm mới**: Xóa lịch sử và bắt đầu hội thoại mới.`,
          `- \`/cost\` — **Chi phí**: Xem thống kê token và chi phí phiên này.`,
          `- \`/status\` — **Trạng thái**: Kiểm tra cấu hình phiên hiện tại.`,
          `- \`/model [tên]\` — **Model**: Xem hoặc chuyển đổi AI model.`,
          `- \`/compact\` — **Nén**: Tóm tắt ngữ cảnh (Claude sẽ thực hiện).`,
          `- \`/help\` — **Trợ giúp**: Hiển thị danh sách này.`,
          ``,
          `*Mẹo: Bạn có thể @mention một agent (vd: \`@coder\`) để giao việc chuyên biệt.*`,
        ];
        addSystemMessage(helpLines.join('\n'));
        break;
      }

      case '/compact': {
        addSystemMessage(`**Đang nén context...** Claude sẽ tóm tắt nội dung và khởi tạo phiên mới để tối ưu bộ nhớ.`);
        compactSession();
        break;
      }

      default: {
        // Custom/plugin slash command — forward cho Claude SDK xử lý.
        // Claude CLI hỗ trợ custom commands natively (từ ~/.claude/commands/ hoặc plugins).
        sendMessage(trimmed);
        break;
      }
    }
  }, [sessionId, projectId, configModel, sessionStats, messagesCount, effortLabel, permissionLabel, sendMessage, startSession, handleModelChange, addSystemMessage, compactSession]);

  return handleSend;
}
