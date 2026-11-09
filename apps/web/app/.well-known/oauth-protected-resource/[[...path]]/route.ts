import { authInstance } from "@/lib/auth";

// RFC 9728 metadata of the MCP endpoint (`/.well-known/oauth-protected-resource/api/mcp`):
// the resource and the authorization server MCP clients sign in through.
// Public on purpose: discovery documents carry no secret. Better Auth's MCP
// plugin answers it from the request path, before any route of its own.
export const GET = (request: Request) => authInstance.handler(request);
export const HEAD = GET;
