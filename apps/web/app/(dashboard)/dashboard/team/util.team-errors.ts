import { ORPCError } from "@orpc/client";

import { apiErrorKey } from "@/lib/orpc/errors";

/**
 * Where the message of a team procedure's error is translated: the team
 * page's own keys (`dashboard.team.*`), with the error's numeric details as
 * their values (the daily cap's `max`), else the shared `errors.*` keys.
 */
export function teamErrorKey(error: unknown): {
  scope: "team" | "errors";
  key: string;
  values: Record<string, number>;
} {
  const data = error instanceof ORPCError ? error.data : null;
  const i18nKey = isRecord(data) ? data.i18nKey : null;
  if (typeof i18nKey === "string" && i18nKey.startsWith("dashboard.team.")) {
    const details = isRecord(data) && isRecord(data.details) ? data.details : {};
    const values = Object.fromEntries(
      Object.entries(details).filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      ),
    );
    return { scope: "team", key: i18nKey.slice("dashboard.team.".length), values };
  }
  return { scope: "errors", key: apiErrorKey(error) ?? "generic", values: {} };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
