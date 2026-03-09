import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpSessionContext } from '../auth/context'
import { registerPromptTemplates } from './templates'

export function registerPrompts(server: McpServer, ctx: McpSessionContext) {
  registerPromptTemplates(server, ctx)
}
