import { handleMcpRequest, handleMcpDiscovery } from '@louez/mcp/http'

export async function POST(request: Request) {
  return handleMcpRequest(request)
}

export async function GET() {
  return handleMcpDiscovery()
}
