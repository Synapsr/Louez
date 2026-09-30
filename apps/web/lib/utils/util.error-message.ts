/**
 * The key of a server error under the `errors` namespace. Procedures and
 * actions report failures as "errors.<key>"; anything else is not meant for
 * the user and falls back to the generic message.
 */
export const getErrorMessageKey = (error: unknown, fallback = "generic"): string => {
  const message = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  return message.startsWith("errors.") ? message.slice("errors.".length) : fallback;
};
