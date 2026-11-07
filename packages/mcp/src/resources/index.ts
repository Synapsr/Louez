import type { McpServer } from '@modelcontextprotocol/server'
import type { McpRequestContext } from '../auth/context'
import { registerStoreResources } from './store'
import { registerDashboardResources } from './dashboard'

export function registerResources(server: McpServer, ctx: McpRequestContext) {
  registerStoreResources(server, ctx)
  registerDashboardResources(server, ctx)
}
