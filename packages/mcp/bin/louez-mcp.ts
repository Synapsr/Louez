#!/usr/bin/env tsx
/**
 * Louez MCP Server — stdio-to-HTTP proxy
 *
 * Bridges Claude Desktop (stdio) to a remote Louez server (Streamable HTTP).
 * The remote server is stateless: each request is authorized on its own.
 * No direct database access — all requests go through the hosted API.
 *
 * Required env vars:
 *   LOUEZ_API_KEY  — Your API key (generate from Settings > API)
 *   LOUEZ_URL      — Your Louez server URL (e.g. https://app.louez.io)
 *
 * Usage with Claude Desktop (claude_desktop_config.json):
 * {
 *   "mcpServers": {
 *     "louez": {
 *       "command": "npx",
 *       "args": ["tsx", "path/to/packages/mcp/bin/louez-mcp.ts"],
 *       "env": {
 *         "LOUEZ_API_KEY": "lz_xxxx_...",
 *         "LOUEZ_URL": "https://app.louez.io"
 *       }
 *     }
 *   }
 * }
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'

// All logging goes to stderr — stdout is reserved for the MCP JSON-RPC protocol
const log = (...args: unknown[]) => console.error('[louez-mcp]', ...args)

async function main() {
  const apiKey = process.env.LOUEZ_API_KEY
  const serverUrl = process.env.LOUEZ_URL

  if (!apiKey) {
    log('LOUEZ_API_KEY environment variable is required.')
    log('Generate one from your Louez dashboard: Settings > API')
    process.exit(1)
  }

  if (!serverUrl) {
    log('LOUEZ_URL environment variable is required.')
    log('Example: https://app.louez.io')
    process.exit(1)
  }

  // ── Remote connection (HTTP client → Louez server) ────────────────────
  const url = new URL('/api/mcp', serverUrl)
  let shuttingDown = false

  const httpTransport = new StreamableHTTPClientTransport(url, {
    requestInit: {
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  })

  const client = new Client({ name: 'louez-mcp', version: '0.1.0' })

  httpTransport.onerror = (error) => {
    if (!shuttingDown) {
      log('Transport error:', error.message)
    }
  }

  httpTransport.onclose = () => {
    if (!shuttingDown) {
      log('Connection to server lost')
      process.exit(1)
    }
  }

  try {
    await client.connect(httpTransport)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (msg.includes('Invalid API key') || msg.includes('401')) {
      log('Authentication failed. Check that LOUEZ_API_KEY is valid.')
    } else {
      log('Failed to connect to', url.href)
      log(msg)
    }
    process.exit(1)
  }

  // ── Local server (stdio → Claude Desktop) ─────────────────────────────
  const server = new Server(
    { name: 'louez', version: '0.1.0' },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  )

  // ── Proxy handlers ────────────────────────────────────────────────────

  server.setRequestHandler('tools/list', (req) => client.listTools(req.params))

  server.setRequestHandler('tools/call', (req) => client.callTool(req.params))

  server.setRequestHandler('resources/list', (req) => client.listResources(req.params))

  server.setRequestHandler('resources/read', (req) => client.readResource(req.params))

  server.setRequestHandler('resources/templates/list', (req) =>
    client.listResourceTemplates(req.params)
  )

  server.setRequestHandler('prompts/list', (req) => client.listPrompts(req.params))

  server.setRequestHandler('prompts/get', (req) => client.getPrompt(req.params))

  // ── Start ─────────────────────────────────────────────────────────────
  const stdioTransport = new StdioServerTransport()
  await server.connect(stdioTransport)

  log('Connected to', url.href)

  // ── Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async () => {
    shuttingDown = true
    await client.close()
    await server.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  log('Fatal:', error instanceof Error ? error.message : error)
  process.exit(1)
})
