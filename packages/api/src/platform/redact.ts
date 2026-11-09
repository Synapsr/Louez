/**
 * A handoff's URLs hold secrets: the link's (`/handoffs/<id><secret>`) and
 * the provider return's state (`/handoffs/return/<id>/<state>`). They must
 * reach no log. These patterns match the secrets only, so the ids stay; the
 * app's logger applies them to every event before it prints or drains it,
 * and provider errors are logged through `logProviderError`.
 */
export const HANDOFF_SECRET_PATTERNS: readonly RegExp[] = [
  // A return or refresh path: its state.
  /(?<=\/handoffs\/(?:return|refresh)\/[A-Za-z0-9_-]{1,64}\/)[A-Za-z0-9_%-]+/g,
  // A link: what follows the handoff's 21-character id.
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

/**
 * A provider's error as one line safe to log: its name, message and the
 * codes a provider gives (Stripe's `type`, `code`, `statusCode`), redacted.
 * Never the error object itself, whose request parameters (a return URL)
 * a provider may echo.
 */
export function describeProviderError(error: unknown): string {
  if (!(error instanceof Error)) return redactHandoffSecrets(String(error));
  const codes = ["type", "code", "statusCode"]
    .map((key) => [key, Reflect.get(error, key)] as const)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${key}=${String(value)}`);
  return redactHandoffSecrets(
    `${error.name}: ${error.message}${codes.length > 0 ? ` (${codes.join(", ")})` : ""}`,
  );
}

/** Logs a provider call that failed, as `describeProviderError` writes it. */
export function logProviderError(label: string, error: unknown): void {
  console.error(`${label}: ${describeProviderError(error)}`);
}
