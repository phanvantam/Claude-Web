import os from 'os';
import path from 'path';
import fs from 'fs';
import { logger } from '../logger';
import { SubAgentInfo, SubAgentEvent } from './types';

/**
 * Resolve đường dẫn tuyệt đối của Claude CLI executable.
 * SDK cần biết đường dẫn tới binary claude để spawn nó bên dưới.
 */
function resolveClaudeBinary(): string {
  // Ưu tiên 1: Biến môi trường do người dùng cấu hình
  if (process.env.CLAUDE_BIN_PATH && fs.existsSync(process.env.CLAUDE_BIN_PATH)) {
    logger.info(`[ClaudeService] Using custom Claude CLI path from env: ${process.env.CLAUDE_BIN_PATH}`);
    return process.env.CLAUDE_BIN_PATH;
  }

  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', 'claude'),
    path.join(home, '.claude', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      logger.info(`[ClaudeService] Found Claude CLI at: ${candidate}`);
      return candidate;
    }
  }

  logger.warn('[ClaudeService] Claude CLI not found at known paths, falling back to "claude"');
  return 'claude';
}

/** Đường dẫn tuyệt đối của Claude CLI — resolve 1 lần khi module load */
const CLAUDE_BIN = resolveClaudeBinary();

/** Trả về đường dẫn cached của Claude CLI binary */
export function getClaudeBinary(): string {
  return CLAUDE_BIN;
}

let sdkModule: any = null;

/** Lazy-load @anthropic-ai/claude-agent-sdk (ESM package trong CJS context) */
export async function getSDK(): Promise<any> {
  if (!sdkModule) sdkModule = await import('@anthropic-ai/claude-agent-sdk');
  return sdkModule;
}

/**
 * Encode cwd theo cách Claude CLI encode: thay tất cả ký tự không phải alphanumeric/dash thành '-'.
 * Ví dụ: /Users/tampv/Projects/tampv.com → -Users-tampv-Projects-tampv-com
 */
export function getEncodedCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, '-');
}

/**
 * Kiểm tra xem Claude CLI có file conversation cho session này không.
 * CLI lưu tại: ~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl
 */
export function hasCliSession(sessionId: string, cwd: string): boolean {
  try {
    const encodedCwd = getEncodedCwd(cwd);
    const sessionFile = path.join(os.homedir(), '.claude', 'projects', encodedCwd, `${sessionId}.jsonl`);
    const exists = fs.existsSync(sessionFile);
    logger.debug(`[ClaudeService] hasCliSession: ${sessionFile} → ${exists}`);
    return exists;
  } catch (err) {
    logger.warn(`[ClaudeService] hasCliSession check failed:`, err);
    return false;
  }
}

/**
 * Scan ~/.claude/projects/ tìm project dir chứa session .jsonl hoặc subagents folder.
 * Trả về cwd (decoded từ encoded dir name) hoặc null nếu không tìm thấy.
 * Dùng cho session từ CLI — không lưu trong DB web app.
 */
export function findSessionCwd(sessionId: string): string | null {
  try {
    const projectsDir = path.join(os.homedir(), '.claude', 'projects');
    if (!fs.existsSync(projectsDir)) return null;

    const dirs = fs.readdirSync(projectsDir);
    for (const encodedDir of dirs) {
      const sessionFile = path.join(projectsDir, encodedDir, `${sessionId}.jsonl`);
      const subagentsDir = path.join(projectsDir, encodedDir, sessionId, 'subagents');

      if (fs.existsSync(sessionFile) || fs.existsSync(subagentsDir)) {
        // Decode: đổi '-' đầu tiên và giữa thành '/' — ước lượng cwd gốc
        // Encoded format: -Users-tampv-Projects-foo → /Users/tampv/Projects/foo
        const decoded = encodedDir.replace(/^-/, '/').replace(/-/g, '/');
        logger.debug(`[ClaudeService] findSessionCwd: ${sessionId} → ${decoded}`);
        return decoded;
      }
    }
  } catch (err) {
    logger.warn(`[ClaudeService] findSessionCwd error:`, err);
  }
  return null;
}

export function listSubAgents(sessionId: string, cwd: string): SubAgentInfo[] {
  try {
    const encodedCwd = getEncodedCwd(cwd);
    const subagentsDir = path.join(os.homedir(), '.claude', 'projects', encodedCwd, sessionId, 'subagents');

    if (!fs.existsSync(subagentsDir)) return [];

    const files = fs.readdirSync(subagentsDir);
    return files
      .filter(f => f.endsWith('.jsonl'))
      .map(f => {
        const agentId = f.replace('.jsonl', '');
        const logPath = path.join(subagentsDir, f);
        const stats = fs.statSync(logPath);

        let messageCount = 0;
        try {
          const content = fs.readFileSync(logPath, 'utf8');
          messageCount = content.split('\n').filter(l => l.trim()).length;
        } catch { }

        // Đọc metadata từ .meta.json — Claude CLI tạo file này khi spawn sub-agent
        let agentType = 'Sub Agent';
        let description = `Sub-agent session ${agentId}`;
        const metaPath = path.join(subagentsDir, `${agentId}.meta.json`);

        let metaParsed = false;
        try {
          if (fs.existsSync(metaPath)) {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta.agentType) agentType = meta.agentType;
            if (meta.description) description = meta.description;
            metaParsed = true;
          }
        } catch { }

        // Không đoán tên từ nội dung JSONL — nếu thiếu meta thì đó là lỗi dữ liệu
        if (!metaParsed) {
          logger.warn(`[listSubAgents] Thiếu .meta.json cho sub-agent ${agentId}. agentType sẽ hiện 'Sub Agent'.`);
        }

        return {
          agentId,
          agentType,
          description,
          messageCount,
          startedAt: stats.birthtime.toISOString(),
        };
      });
  } catch (err) {
    logger.error(`[ClaudeService] Error listing subagents:`, err);
    return [];
  }
}

export function getSubAgentTimeline(sessionId: string, agentId: string, cwd: string): SubAgentEvent[] {
  try {
    const encodedCwd = getEncodedCwd(cwd);
    const logFile = path.join(os.homedir(), '.claude', 'projects', encodedCwd, sessionId, 'subagents', `${agentId}.jsonl`);

    if (!fs.existsSync(logFile)) return [];

    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n').filter(l => l.trim());

    return lines.map(line => {
      const data = JSON.parse(line);
      const type = data.type as string;

      let event: SubAgentEvent = {
        type: 'text',
        content: '',
        timestamp: data.timestamp || new Date().toISOString()
      };

      if (type === 'assistant') {
        const block = data.message?.content?.[0];
        if (block?.type === 'thinking') {
          event.type = 'thinking';
          event.content = block.thinking || block.thought || '';
        } else if (block?.type === 'tool_use') {
          event.type = 'tool_use';
          event.content = JSON.stringify({ name: block.name, input: block.input }, null, 2);
          event.toolName = String(block.name || '');
        } else {
          event.content = block?.text || '';
        }
      } else if (type === 'user') {
        const block = data.message?.content?.[0];
        if (block?.type === 'tool_result') {
          event.type = 'tool_result';
          event.content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content, null, 2);
          event.isError = !!block.is_error;
        } else {
          event.content = block?.text || '';
        }
      }

      return event;
    });
  } catch (err) {
    logger.error(`[ClaudeService] Error reading subagent timeline:`, err);
    return [];
  }
}
