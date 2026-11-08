import type { UrlsPort } from "./ports";

/** The app URL of the test deployment. */
export const TEST_APP_URL = "https://app.louez.test";

/** The urls port of a platform deployment on `louez.test`, for tests. */
export function createTestUrls(): UrlsPort {
  return {
    dashboard: (path) => `${TEST_APP_URL}${path}`,
    storefront: (storeSlug, path) => `https://${storeSlug}.louez.test${path === "/" ? "" : path}`,
  };
}
