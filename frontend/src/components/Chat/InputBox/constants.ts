import React, { ReactNode } from 'react';
import { WarningFilled } from '@ant-design/icons';

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  Write: 'Ghi nội dung vào file. Tạo mới hoặc ghi đè file hiện có.',
  Read: 'Đọc nội dung file từ hệ thống.',
  Edit: 'Chỉnh sửa một phần file hiện có (tìm và thay thế).',
  Glob: 'Tìm kiếm file theo pattern (ví dụ: *.ts, src/**/*.tsx).',
  Grep: 'Tìm kiếm nội dung trong file theo regex hoặc chuỗi.',
  Bash: 'Thực thi lệnh shell trên hệ thống.',
  MultiEdit: 'Thực hiện nhiều chỉnh sửa cùng lúc trên một file.',
  LS: 'Liệt kê nội dung thư mục.',
  WebSearch: 'Tìm kiếm trên web.',
  WebFetch: 'Tải nội dung từ URL.',
  TodoRead: 'Đọc danh sách todo/task.',
  TodoWrite: 'Cập nhật danh sách todo/task.',
};

export function getToolDescription(toolName: string): string | null {
  if (TOOL_DESCRIPTIONS[toolName]) return TOOL_DESCRIPTIONS[toolName];

  if (toolName.startsWith('mcp__')) {
    const parts = toolName.split('__');
    const server = parts[1] || '';
    const tool = parts.slice(2).join('__') || '';
    return `Tool MCP từ server "${server}": ${tool}`;
  }

  return null;
}

type HelpInfo = {
  title: string;
  desc: ReactNode;
};

export const MODEL_HELP: Record<string, HelpInfo> = {
  sonnet: {
    title: 'Claude Sonnet',
    desc: 'Model cân bằng giữa tốc độ và chất lượng. Phù hợp cho hầu hết tác vụ coding thông thường.',
  },
  opus: {
    title: 'Claude Opus',
    desc: 'Model mạnh nhất, suy luận sâu. Dùng cho tác vụ phức tạp, kiến trúc hệ thống, debug khó.',
  },
  haiku: {
    title: 'Claude Haiku',
    desc: 'Model nhanh nhất, chi phí thấp. Phù hợp cho câu hỏi đơn giản, refactor nhỏ.',
  },
};

export const EFFORT_HELP: Record<string, HelpInfo> = {
  low: {
    title: 'Mức thấp',
    desc: 'Trả lời nhanh, ít suy nghĩ. Tiết kiệm token nhưng có thể bỏ sót chi tiết. Phù hợp cho câu hỏi đơn giản.',
  },
  medium: {
    title: 'Mức trung bình',
    desc: 'Cân bằng giữa tốc độ và chất lượng. Mức mặc định, phù hợp cho đa số tác vụ.',
  },
  high: {
    title: 'Mức cao',
    desc: 'Suy nghĩ kỹ, phân tích sâu. Tốn nhiều token hơn nhưng cho kết quả chi tiết và chính xác nhất.',
  },
};

export const PERMISSION_HELP: Record<string, HelpInfo> = {
  default: {
    title: 'Chế độ mặc định',
    desc: 'Claude sẽ hỏi xác nhận trước khi thực hiện bất kỳ thao tác nào ảnh hưởng đến file hoặc hệ thống.',
  },
  acceptEdits: {
    title: 'Chấp nhận chỉnh sửa',
    desc: 'Tự động chấp nhận đọc/ghi file. Vẫn hỏi trước khi chạy lệnh shell hoặc thao tác nguy hiểm.',
  },
  auto: {
    title: 'AI tự quyết định',
    desc: 'Sử dụng AI classifier để đánh giá mức độ rủi ro. Tự động cho phép thao tác an toàn (đọc file, tìm kiếm), chỉ hỏi khi lệnh có nguy cơ cao.',
  },
  bypassPermissions: {
    title: 'Bỏ qua tất cả quyền',
    desc: (
      <span>
        <WarningFilled style={{ color: '#faad14', marginRight: 4 }} />
        Không hỏi bất kỳ quyền nào. Claude tự do thực thi mọi tool. Chỉ dùng khi bạn hoàn toàn tin tưởng.
      </span>
    ),
  },
  plan: {
    title: 'Chỉ lập kế hoạch',
    desc: 'Claude chỉ phân tích và đề xuất. Không thực thi bất kỳ tool nào. An toàn để review trước.',
  },
  dontAsk: {
    title: 'Không hỏi',
    desc: 'Không hỏi quyền — từ chối nếu tool chưa được phê duyệt trước.',
  },
};
