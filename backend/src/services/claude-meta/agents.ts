/**
 * Quản lý Agent definitions: scan, parse, CRUD, và build SDK definitions.
 *
 * Tách từ claude-meta.ts — nhóm các hàm liên quan đến agent
 * (multi-scope discovery, frontmatter parsing, SDK integration).
 */

import fs from 'fs';
import path from 'path';
import {
  CLAUDE_HOME,
  AgentScope, AgentFrontmatter, AgentDefinition,
  parseFrontmatter,
} from './shared';

// ============================
// Agents — Multi-scope: user (~/.claude/agents/), project (.claude/agents/), local (agents/)
// Theo tài liệu: https://code.claude.com/docs/en/sub-agents#choose-the-subagent-scope
// ============================
const AGENTS_DIR = path.join(CLAUDE_HOME, 'agents');

/**
 * Quét agent files (.md) trong 1 thư mục cụ thể.
 * Trả về danh sách AgentDefinition kèm scope và frontmatter đầy đủ.
 */
function scanAgentsInDir(dir: string, scope: AgentScope): AgentDefinition[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filePath = path.join(dir, f);
        const fm = parseFrontmatter(filePath);
        return {
          name: fm.name || f.replace('.md', ''),
          filename: f,
          scope,
          filePath,
          frontmatter: fm,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Lấy TOÀN BỘ agents từ 3 scope: user (global), project, local.
 * Thứ tự ưu tiên: local > project > user (theo tài liệu Claude Code).
 * Nếu trùng tên, scope hẹp hơn sẽ ghi đè scope rộng.
 */
export function listAllAgents(projectPath?: string): AgentDefinition[] {
  // 1. User scope: ~/.claude/agents/
  const userAgents = scanAgentsInDir(AGENTS_DIR, 'user');

  // 2. Project scope: <projectPath>/.claude/agents/
  const projectAgents = projectPath
    ? scanAgentsInDir(path.join(projectPath, '.claude', 'agents'), 'project')
    : [];

  // 3. Local scope: <projectPath>/agents/
  const localAgents = projectPath
    ? scanAgentsInDir(path.join(projectPath, 'agents'), 'local')
    : [];

  // Merge — local > project > user (scope hẹp ghi đè rộng)
  const merged = new Map<string, AgentDefinition>();
  for (const agent of userAgents) merged.set(agent.name, agent);
  for (const agent of projectAgents) merged.set(agent.name, agent);
  for (const agent of localAgents) merged.set(agent.name, agent);

  return Array.from(merged.values());
}

/**
 * Tương thích ngược: listAgents() — chỉ quét user scope.
 * Dùng cho các API cũ chưa truyền projectPath.
 */
export function listAgents(): { name: string; filename: string }[] {
  return scanAgentsInDir(AGENTS_DIR, 'user').map(a => ({
    name: a.name,
    filename: a.filename,
  }));
}

/**
 * Tương thích ngược: listAgentsWithDescription().
 * Dùng cho @mention autocomplete — nay đã hỗ trợ scope nếu có projectPath.
 */
export function listAgentsWithDescription(projectPath?: string): {
  name: string; filename: string; description: string; scope: AgentScope;
  model?: string; tools?: string[]; permissionMode?: string;
}[] {
  const agents = projectPath ? listAllAgents(projectPath) : scanAgentsInDir(AGENTS_DIR, 'user');
  return agents.map(a => ({
    name: a.name,
    filename: a.filename,
    description: a.frontmatter.description || '',
    scope: a.scope,
    model: a.frontmatter.model,
    tools: a.frontmatter.tools,
    permissionMode: a.frontmatter.permissionMode,
  }));
}

/**
 * Đọc nội dung một agent file.
 * Hỗ trợ scope: tìm trong user dir, nếu có projectPath thì tìm cả project/local.
 */
export function getAgent(filename: string, projectPath?: string): string {
  // Thử theo thứ tự ưu tiên scope: local > project > user
  if (projectPath) {
    const localPath = path.join(projectPath, 'agents', filename);
    if (fs.existsSync(localPath)) return fs.readFileSync(localPath, 'utf-8');
    const projPath = path.join(projectPath, '.claude', 'agents', filename);
    if (fs.existsSync(projPath)) return fs.readFileSync(projPath, 'utf-8');
  }
  const userPath = path.join(AGENTS_DIR, filename);
  if (fs.existsSync(userPath)) return fs.readFileSync(userPath, 'utf-8');
  throw new Error(`Agent không tồn tại: ${filename}`);
}

/**
 * Chuyển đổi danh sách agent files sang format SDK `options.agents`.
 * SDK sẽ tự điều phối tool `Agent`/`Task` với các definitions này,
 * thay vì Backend phải parse tool_use thủ công.
 *
 * Trả về Record<agentName, SDKAgentDef> hoặc object rỗng nếu không có agent nào.
 */
export function buildSDKAgentDefinitions(projectPath?: string): Record<string, {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
  maxTurns?: number;
  permissionMode?: string;
}> {
  const agents = listAllAgents(projectPath);
  const result: Record<string, any> = {};

  for (const agent of agents) {
    try {
      const content = getAgent(agent.filename, projectPath);
      // Bỏ phần frontmatter (---...---), chỉ lấy body markdown làm prompt
      const promptBody = content.replace(/^---[\s\S]*?---\s*/, '').trim();
      if (!promptBody) continue; // Bỏ qua agent không có nội dung prompt

      result[agent.name] = {
        description: agent.frontmatter.description || `Agent ${agent.name}`,
        prompt: promptBody,
        // Chỉ truyền các field có giá trị — tránh override mặc định của SDK
        ...(agent.frontmatter.tools && { tools: agent.frontmatter.tools }),
        ...(agent.frontmatter.model && agent.frontmatter.model !== 'inherit' && { model: agent.frontmatter.model }),
        ...(agent.frontmatter.maxTurns && { maxTurns: agent.frontmatter.maxTurns }),
        ...(agent.frontmatter.permissionMode && { permissionMode: agent.frontmatter.permissionMode }),
      };
    } catch {
      // Bỏ qua agent không đọc được — không block toàn bộ query
    }
  }

  return result;
}

/**
 * Ghi nội dung vào agent file.
 * scope = 'user' → ~/.claude/agents/, 'project' → <projectPath>/.claude/agents/
 */
export function saveAgent(filename: string, content: string, scope: AgentScope = 'user', projectPath?: string): void {
  const dir = resolveAgentDir(scope, projectPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), content, 'utf-8');
}

/**
 * Tạo agent file mới với template chứa các field cấu hình gợi ý.
 */
export function createAgent(name: string, scope: AgentScope = 'user', projectPath?: string): string {
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const dir = resolveAgentDir(scope, projectPath);
  const filePath = path.join(dir, filename);
  if (fs.existsSync(filePath)) throw new Error(`Agent đã tồn tại: ${filename}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Template gợi ý các field frontmatter phổ biến — giúp lập trình viên nhanh chóng cấu hình
  const safeName = name.replace('.md', '');
  const template = `---
name: ${safeName}
description: Mô tả ngắn về agent ${safeName}
model: inherit
tools: Read, Grep, Glob, Bash
# permissionMode: default
# memory: project
# background: false
---

Bạn là agent chuyên biệt "${safeName}". Khi được gọi, hãy thực hiện nhiệm vụ theo mô tả ở trên.
`;
  fs.writeFileSync(filePath, template, 'utf-8');
  return filename;
}

/**
 * Xóa agent file.
 */
export function deleteAgent(filename: string, scope: AgentScope = 'user', projectPath?: string): void {
  const dir = resolveAgentDir(scope, projectPath);
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) throw new Error(`Agent không tồn tại: ${filename}`);
  fs.unlinkSync(filePath);
}

/**
 * Resolve thư mục agents theo scope.
 */
function resolveAgentDir(scope: AgentScope, projectPath?: string): string {
  switch (scope) {
    case 'project':
      if (!projectPath) throw new Error('projectPath bắt buộc khi scope = project');
      return path.join(projectPath, '.claude', 'agents');
    case 'local':
      if (!projectPath) throw new Error('projectPath bắt buộc khi scope = local');
      return path.join(projectPath, 'agents');
    case 'user':
    default:
      return AGENTS_DIR;
  }
}
