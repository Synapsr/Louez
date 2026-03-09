import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { McpSessionContext } from '../auth/context'
import { registerStoreResources } from './store'
import { registerDashboardResources } from './dashboard'

export function registerResources(server: McpServer, ctx: McpSessionContext) {
  registerStoreResources(server, ctx)
  registerDashboardResources(server, ctx)
}
