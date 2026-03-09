import { randomUUID } from 'crypto'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { resolveApiKeyContext } from '../auth/api-keys'
import type { McpSessionContext } from '../auth/context'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpServer } from '../server'

// ── Session management ─────────────────────────────────────────────────
// The MCP protocol requires a stateful session: the client sends `initialize`,
// then `initialized`, then tool calls — each as separate HTTP requests.
// We keep server+transport pairs alive in an in-memory Map keyed by session ID
// and route subsequent requests to the correct instance.

interface McpSession {
  server: McpServer
  transport: WebStandardStreamableHTTPServerTransport
  ctx: McpSessionContext
  createdAt: number
}

const sessions = new Map<string, McpSession>()
const SESSION_TTL_MS = 30 * 60 * 1000 // 30 minutes

function removeSession(sessionId: string) {
  const session = sessions.get(sessionId)
  if (session) {
    sessions.delete(sessionId)
    void session.server.close()
  }
}

function cleanExpiredSessions() {
  const now = Date.now()
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      removeSession(id)
    }
  }
}

// ── Auth helpers ───────────────────────────────────────────────────────

function extractBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) return null
  return authorization.slice(7)
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// ── Request handlers ───────────────────────────────────────────────────

/**
 * Handle an incoming MCP HTTP request (POST or GET with session).
 *
 * - First request (no session ID): authenticates via API key, creates a
 *   server+transport pair, processes the `initialize` handshake, and stores
 *   the session.
 * - Subsequent requests (with Mcp-Session-Id header): routes to the existing
 *   session's transport for processing.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  cleanExpiredSessions()

  const rawKey = extractBearerToken(request)
  if (!rawKey) {
    return jsonResponse({ error: 'Missing or invalid Authorization header. Use: Bearer <api-key>' }, 401)
  }

  // ── Existing session ──────────────────────────────────────────────
  const sessionId = request.headers.get('mcp-session-id')
  if (sessionId) {
    const session = sessions.get(sessionId)
    if (!session) {
      return jsonResponse({ error: 'Session not found or expired. Re-initialize.' }, 404)
    }
    return session.transport.handleRequest(request)
  }

  // ── New session ───────────────────────────────────────────────────
  const ctx = await resolveApiKeyContext(rawKey)
  if (!ctx) {
    return jsonResponse({ error: 'Invalid API key. It may be expired or revoked.' }, 401)
  }

  const server = createMcpServer(ctx)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessionclosed: (closedSessionId: string) => {
      removeSession(closedSessionId)
    },
  })

  await server.connect(transport)

  const response = await transport.handleRequest(request)

  // The transport includes the session ID in the response header after initialize
  const newSessionId = response.headers.get('mcp-session-id')
  if (newSessionId) {
    sessions.set(newSessionId, { server, transport, ctx, createdAt: Date.now() })
  }

  return response
}

/**
 * Handle MCP session termination (DELETE with Mcp-Session-Id header).
 */
export async function handleMcpDelete(request: Request): Promise<Response> {
  const rawKey = extractBearerToken(request)
  if (!rawKey) {
    return jsonResponse({ error: 'Missing or invalid Authorization header.' }, 401)
  }

  const sessionId = request.headers.get('mcp-session-id')
  if (!sessionId) {
    return jsonResponse({ error: 'Missing Mcp-Session-Id header' }, 400)
  }

  const session = sessions.get(sessionId)
  if (!session) {
    // Already gone — idempotent success
    return new Response(null, { status: 204 })
  }

  const response = await session.transport.handleRequest(request)
  removeSession(sessionId)
  return response
}

/**
 * Discovery endpoint — returns server metadata for MCP clients.
 * Called via GET when no Mcp-Session-Id header is present.
 */
export function handleMcpDiscovery(): Response {
  return new Response(
    JSON.stringify({
      name: 'louez',
      version: '0.1.0',
      description: 'Louez rental management MCP server',
      transport: 'streamable-http',
      authentication: 'bearer',
    }),
    { headers: { 'Content-Type': 'application/json' } }
  )
}
