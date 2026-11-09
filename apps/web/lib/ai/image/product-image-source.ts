const SCALEWAY_PRODUCT_IMAGE_HOST_PATTERN = /^[a-z0-9-]+\.s3\.fr-par\.scw\.cloud$/;
const PRODUCT_IMAGE_PATH_PATTERN = /^\/[a-zA-Z0-9/_-]+\.(?:jpe?g|png|webp)$/;

/**
 * Demo catalogs can reference product photos from another Louez bucket.
 * Only accept public Scaleway Object Storage image URLs: this keeps the
 * server-side fetch away from arbitrary hosts and private network targets.
 */
export function parseTrustedDemoProductImageUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !SCALEWAY_PRODUCT_IMAGE_HOST_PATTERN.test(url.hostname) ||
      !PRODUCT_IMAGE_PATH_PATTERN.test(url.pathname)
    ) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}
