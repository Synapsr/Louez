import { handleMcpRequest, handleMcpDelete, handleMcpDiscovery } from '@louez/mcp/http'

export async function POST(request: Request) {
  return handleMcpRequest(request)
}

export async function GET(request: Request) {
  // If session ID present, this is an SSE stream request — delegate to transport
  if (request.headers.get('mcp-session-id')) {
    return handleMcpRequest(request)
  }
  // Otherwise, return server discovery metadata
  return handleMcpDiscovery()
}

export async function DELETE(request: Request) {
  return handleMcpDelete(request)
}
