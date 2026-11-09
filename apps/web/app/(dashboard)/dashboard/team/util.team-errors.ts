import { ORPCError } from "@orpc/client";

import { apiErrorKey } from "@/lib/orpc/errors";

/**
 * Where the message of a team procedure's error is translated: the team
 * page's own keys (`dashboard.team.*`), else the shared `errors.*` keys.
 */
export function teamErrorKey(error: unknown): { scope: "team" | "errors"; key: string } {
  const i18nKey =
    error instanceof ORPCError ? (error.data as { i18nKey?: unknown } | undefined)?.i18nKey : null;
  if (typeof i18nKey === "string" && i18nKey.startsWith("dashboard.team.")) {
    return { scope: "team", key: i18nKey.slice("dashboard.team.".length) };
  }
  return { scope: "errors", key: apiErrorKey(error) ?? "generic" };
}
