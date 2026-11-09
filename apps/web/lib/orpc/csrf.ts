import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";

/**
 * CSRF boundary of `/api/rpc`, the session-cookie transport. Every call must
 * carry a custom header (`x-csrf-token: orpc`) that only script on our own
 * origin can add: a cross-site page cannot send it without a CORS preflight,
 * which the app never grants, and an HTML form or a navigation cannot send it
 * at all. So a foreign site, even a same-site one, cannot make a signed-in
 * user's browser call a procedure. The handler refuses a call without it
 * (403 `CSRF_TOKEN_MISMATCH`); the app's RPC link adds it to every call.
 *
 * The assistant's server-side client (`createRouterClient`) calls procedures
 * in process, not over HTTP, so neither applies there.
 */
export const rpcCsrfHandlerPlugin = () => new SimpleCsrfProtectionHandlerPlugin();

export const rpcCsrfLinkPlugin = () => new SimpleCsrfProtectionLinkPlugin();
