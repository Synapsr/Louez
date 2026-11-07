import { authInstance } from "@/lib/auth";

// RFC 8414 metadata of the authorization server, at the path its issuer
// (`<app>/api/auth`) implies: `/.well-known/oauth-authorization-server/api/auth`.
// Public on purpose: discovery documents carry no secret. Better Auth's OAuth
// provider answers it from the request path; any other path is a 404.
export const GET = (request: Request) => authInstance.handler(request);
export const HEAD = GET;
