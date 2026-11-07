import { ORPCError } from "@orpc/client";

/**
 * The `errors.*` translation key to show for an API error, without its
 * `errors.` prefix, or null when it has none (show `errors.generic`).
 *
 * Agent-ready procedures put it in `data.i18nKey` and keep `message` in plain
 * English for agents (packages/api platform/errors.ts); older procedures put
 * the key in `message`.
 */
export function apiErrorKey(error: unknown): string | null {
  if (!(error instanceof ORPCError)) return null;
  const data = error.data as { i18nKey?: unknown } | undefined;
  const key = typeof data?.i18nKey === "string" ? data.i18nKey : error.message;
  return key.startsWith("errors.") ? key.slice("errors.".length) : null;
}
