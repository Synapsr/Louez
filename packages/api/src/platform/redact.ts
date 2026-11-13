/**
 * A handoff's URLs may hold secrets: the provider return's state
 * (`/handoffs/return/<id>/<state>`), and the secret of a link given before
 * links were addressed by id (`/handoffs/<id><secret>`; a step's page is
 * `/handoffs/<id>` now, and its id is no secret). They must reach no log.
 * These patterns match the secrets only, so the ids stay; the
 * app's logger applies them to every event before it prints or drains it,
 * and provider errors are logged through `logProviderError`
 * (`sanitize-error.ts`).
 */
export const HANDOFF_SECRET_PATTERNS: readonly RegExp[] = [
  // A return or refresh path: its state.
  /(?<=\/handoffs\/(?:return|refresh)\/[A-Za-z0-9_-]{1,64}\/)[A-Za-z0-9_%-]+/g,
  // An older link: what follows the handoff's 21-character id.
  /(?<=\/handoffs\/(?!return\/|refresh\/|done\/|resume\b)[A-Za-z0-9_-]{21})[A-Za-z0-9_%-]+/g,
  // The same, URL-encoded (a callback or a query).
  /(?<=%2Fhandoffs%2F)[A-Za-z0-9_%-]+/gi,
];

export const REDACTED = "[redacted]";

/** `text` with every handoff secret replaced, the ids kept. */
export function redactHandoffSecrets(text: string): string {
  return HANDOFF_SECRET_PATTERNS.reduce((result, pattern) => {
    pattern.lastIndex = 0;
    return result.replace(pattern, REDACTED);
  }, text);
}
