/** Parameters the authorization server adds to the query it signs, not part of the request. */
const SIGNATURE_PARAMS = ["sig", "exp", "ba_iat", "ba_param", "ba_pl"];

const AUTHORIZE_PATH = "/api/auth/oauth2/authorize";

/**
 * Where to go after signing in when an MCP client (Claude, ChatGPT…) sent the
 * visitor here to authorize it: back to the authorization endpoint with the
 * client's request, which then shows the consent page. Null for an ordinary
 * sign-in. The endpoint checks every parameter again; the path is fixed here.
 *
 * The visitor has just signed in, so `prompt=login` and `max_age` are dropped:
 * they would only send the visitor back to this page.
 */
export const oauthAuthorizeUrl = (searchParams: URLSearchParams): string | null => {
  if (!searchParams.get("sig") || !searchParams.get("client_id")) return null;
  const params = new URLSearchParams(searchParams);
  for (const name of [...SIGNATURE_PARAMS, "max_age", "callbackUrl"]) params.delete(name);
  const prompt = (params.get("prompt") ?? "")
    .split(" ")
    .filter((value) => value && value !== "login");
  if (prompt.length > 0) params.set("prompt", prompt.join(" "));
  else params.delete("prompt");
  return `${AUTHORIZE_PATH}?${params.toString()}`;
};
