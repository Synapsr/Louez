/**
 * The origins the app is served on, as the auth layer trusts them: the
 * configured AUTH_URL, and in development every Localify host of the
 * project (`DEV_AUTH_HOSTS`): the namespace, each worktree and storefront
 * under it, and its Localify Cloud public URLs. Better Auth takes its base
 * URL from these (index.ts); a same-origin check of the app that must accept
 * exactly those pages reads them here (`isTrustedAppOrigin`), never from the
 * request's own URL or a forwarded header.
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

/** A host pattern as a whole-host match: `*` stands for one label's characters, never a dot. */
const hostPattern = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[a-z0-9-]+")}$`,
  );

const DEV_HOST_PATTERNS = DEV_AUTH_HOSTS.map(hostPattern);

/**
 * Whether `origin` (a request's `Origin`, as the browser wrote it) is one the
 * app is served on: AUTH_URL's origin, or, in development, an `https`
 * origin on one of `DEV_AUTH_HOSTS` with no port.
 */
export function isTrustedAppOrigin(
  origin: string,
  policy: { authUrl: string; development: boolean },
): boolean {
  if (origin === new URL(policy.authUrl).origin) return true;
  if (!policy.development) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin || url.protocol !== "https:" || url.port !== "") return false;
  return DEV_HOST_PATTERNS.some((pattern) => pattern.test(url.hostname));
}
