/**
 * Facade module — re-export toàn bộ API công khai từ các module con.
 *
 * File gốc (~783 dòng) đã được tách thành:
 *   - claude-meta/shared.ts    — types, constants, hàm tiện ích dùng chung
 *   - claude-meta/models.ts    — quản lý model aliases và cấu hình
 *   - claude-meta/agents.ts    — agent discovery, CRUD, SDK definitions
 *   - claude-meta/commands.ts  — slash commands (builtin, plugin, custom)
 *   - claude-meta/mcp.ts       — MCP server configuration
 *   - claude-meta/settings.ts  — raw settings.json đọc/ghi
 *
 * Các module khác import từ 'claude-meta' sẽ KHÔNG cần thay đổi import path.
 */

// Types — re-export để các module khác dùng trực tiếp
export type { SlashCommand, AgentScope, AgentFrontmatter, AgentDefinition } from './claude-meta/shared';
export type { ModelInfo } from './claude-meta/models';

// Models
export { getAllModels, getCurrentModel } from './claude-meta/models';

// Agents
export {
  listAllAgents, listAgents, listAgentsWithDescription,
  getAgent, buildSDKAgentDefinitions,
  saveAgent, createAgent, deleteAgent,
} from './claude-meta/agents';

// Commands
export {
  getAllCommands,
  listCustomCommands, getCustomCommand, saveCustomCommand, deleteCustomCommand,
} from './claude-meta/commands';

// MCP
export {
  getMcpServers, updateMcpServers,
  getMcpServersDetailed, updateProjectMcpServers,
} from './claude-meta/mcp';

// Settings
export { getRawSettings, updateRawSettings } from './claude-meta/settings';
