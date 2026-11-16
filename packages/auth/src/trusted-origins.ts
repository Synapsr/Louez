/**
 * The origins the app is served on, as the auth layer trusts them, in one
 * place. `authOriginOptions` is what the auth configuration hands Better
 * Auth (index.ts), and nothing else of it names an origin: AUTH_URL, and in
 * development every Localify host of the project (`DEV_AUTH_HOSTS`). Better
 * Auth adds the origins an operator lists in `BETTER_AUTH_TRUSTED_ORIGINS`,
 * read by Better Auth itself. A same-origin check of the app that must accept
 * exactly those pages asks Better Auth's own resolver, built from these
 * options (`trustedOriginCheck`), never the request's own URL nor a
 * forwarded header: the two cannot drift.
 */
export const DEV_AUTH_HOSTS = [
  "louez.localify",
  "*.louez.localify",
  "louez.localify.fyi",
  "louez--*.localify.fyi",
  // The public URL of the project served from another machine, which Localify
  // names louez-<login> because "louez" is taken (e.g. a preview run on a
  // build machine of the tailnet).
  "louez-*.localify.fyi",
];

/**
 * The options Better Auth takes its trusted origins from. In development it
 * takes its base URL, and the origin it trusts, from the host a request came
 * in on, read from X-Forwarded-Host, among `DEV_AUTH_HOSTS` only; any other
 * host falls back to AUTH_URL. So a new worktree or a public URL works
 * without editing AUTH_URL. Production keeps the fixed AUTH_URL.
 */
export function authOriginOptions(config: { authUrl: string; development: boolean }) {
  return {
    baseURL: config.development
      ? { allowedHosts: DEV_AUTH_HOSTS, fallback: config.authUrl }
      : config.authUrl,
    trustedOrigins: [config.authUrl],
  };
}

/** What `trustedOriginCheck` reads of a Better Auth instance: its resolved context. */
export interface TrustedOriginSource {
  $context: Promise<{ isTrustedOrigin: (url: string) => boolean }>;
}

/**
 * Whether an origin is one the auth layer trusts, as Better Auth itself
 * decides it from its options and `BETTER_AUTH_TRUSTED_ORIGINS`: the same
 * list, the same parsing, the same patterns.
 */
export const trustedOriginCheck =
  (instance: TrustedOriginSource) =>
  async (origin: string): Promise<boolean> =>
    (await instance.$context).isTrustedOrigin(origin);
