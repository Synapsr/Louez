/**
 * Resolve a possibly-relative asset URL against a base origin.
 *
 * Stored asset URLs are site-relative paths ("/files/…") on standalone
 * deployments; consumers that leave the web origin — emails, PDFs — must
 * absolutize them. Already-absolute URLs pass through untouched, so this is
 * a no-op for cloud deployments with a public bucket URL.
 */
export function toAbsoluteUrl(
  url: string,
  baseUrl: string | undefined,
): string {
  if (!url.startsWith('/') || url.startsWith('//')) return url
  if (!baseUrl) return url
  return `${baseUrl.replace(/\/+$/, '')}${url}`
}
