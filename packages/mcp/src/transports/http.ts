import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'

import { resolveApiKeyContext } from '../auth/api-keys'
import { createMcpServer } from '../server'

/**
 * Handle an incoming MCP HTTP request.
 * Used by the Next.js API route to serve MCP over Streamable HTTP.
 *
 * Authentication is via Bearer token (API key) in the Authorization header.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  // Extract and validate API key
  const authorization = request.headers.get('authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Missing or invalid Authorization header. Use: Bearer <api-key>' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  const rawKey = authorization.slice(7)
  const ctx = await resolveApiKeyContext(rawKey)
  if (!ctx) {
    return new Response(
      JSON.stringify({ error: 'Invalid API key. It may be expired or revoked.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    )
  }

  // Create a fresh server + transport per request (stateless HTTP)
  const server = createMcpServer(ctx)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  })

  await server.connect(transport)

  // Delegate to the transport's request handler
  return transport.handleRequest(request)
}

/**
 * Discovery endpoint — returns server metadata for MCP clients.
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
