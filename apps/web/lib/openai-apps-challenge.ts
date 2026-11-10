/**
 * OpenAI's domain check for the Louez plugin: OpenAI's plugin portal shows a
 * token, and the MCP server's domain serves it as plain text at
 * `/.well-known/openai-apps-challenge`. The token is public, not a secret.
 */

/** Longest token served: OpenAI's tokens are much shorter. */
const MAX_TOKEN_LENGTH = 512;

/**
 * The token as served: `value` without surrounding whitespace, or null when
 * it is unset, empty, longer than 512 characters, or holds whitespace (more
 * than one word is not a token).
 */
export function cleanOpenAiAppsChallenge(value: string | undefined): string | null {
  const token = value?.trim() ?? "";
  if (!token || token.length > MAX_TOKEN_LENGTH || /\s/.test(token)) return null;
  return token;
}

/** The challenge's answer: the token alone in plain text, or 404 without one. */
export function openAiAppsChallengeResponse(value: string | undefined): Response {
  const token = cleanOpenAiAppsChallenge(value);
  const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  if (!token) return new Response("Not Found", { status: 404, headers });
  return new Response(token, { status: 200, headers });
}
