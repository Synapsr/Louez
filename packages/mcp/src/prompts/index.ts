import type { McpServer } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '../auth/context'
import { registerPromptTemplates } from './templates'

export function registerPrompts(server: McpServer, ctx: McpRequestContext) {
  registerPromptTemplates(server, ctx)
}
