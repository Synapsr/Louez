#!/usr/bin/env tsx
/**
 * Louez MCP Server — stdio transport
 *
 * Usage with Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "louez": {
 *       "command": "npx",
 *       "args": ["tsx", "packages/mcp/bin/louez-mcp.ts"],
 *       "env": {
 *         "LOUEZ_API_KEY": "lz_xxxx_...",
 *         "DATABASE_URL": "mysql://..."
 *       }
 *     }
 *   }
 * }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { resolveApiKeyContext } from '../src/auth/api-keys'
import { createMcpServer } from '../src/server'

async function main() {
  const apiKey = process.env.LOUEZ_API_KEY
  if (!apiKey) {
    console.error('Error: LOUEZ_API_KEY environment variable is required.')
    console.error('Generate an API key from your Louez dashboard: Settings > API')
    process.exit(1)
  }

  const ctx = await resolveApiKeyContext(apiKey)
  if (!ctx) {
    console.error('Error: Invalid API key. It may be expired, revoked, or incorrect.')
    process.exit(1)
  }

  const server = createMcpServer(ctx)
  const transport = new StdioServerTransport()

  await server.connect(transport)

  // Graceful shutdown
  process.on('SIGINT', async () => {
    await server.close()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
