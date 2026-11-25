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

/** A separator, plain or percent-encoded once or more: `/`, `%2F`, `%252F`… */
const SLASH = String.raw`(?:\/|%(?:25)*2[Ff])`;
/**
 * One character of a secret, plain or percent-encoded once or more (`p`,
 * `%70`, `%2570`…), never an encoded separator or a lone `%`.
 */
const SECRET_CHARACTER = String.raw`(?:[A-Za-z0-9_-]|%(?:25)*(?!25|2[Ff])[0-9A-Fa-f]{2})`;

/**
 * A partner's space (Liens partenaires) is opened by its secret alone,
 * `/partner/<secret>`: whoever holds it reads the space and sets the
 * partner's e-mails. The pattern matches the secret only, in a path or a URL,
 * plain or percent-encoded, nested encodings included; what follows it
 * (`/notifications`) stays.
 */
const PARTNER_SPACE_SECRET_PATTERNS: readonly RegExp[] = [
  new RegExp(`(?<=${SLASH}partner${SLASH})${SECRET_CHARACTER}+`, "g"),
];

/** Every secret a URL may hold: what the app's logger replaces in every event. */
export const LOG_SECRET_PATTERNS: readonly RegExp[] = [
  ...HANDOFF_SECRET_PATTERNS,
  ...PARTNER_SPACE_SECRET_PATTERNS,
];

export const REDACTED = "[redacted]";

/** `text` with every handoff secret replaced, the ids kept. */
export function redactHandoffSecrets(text: string): string {
  return HANDOFF_SECRET_PATTERNS.reduce((result, pattern) => {
    pattern.lastIndex = 0;
    return result.replace(pattern, REDACTED);
  }, text);
}
