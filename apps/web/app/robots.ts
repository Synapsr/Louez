import type { MetadataRoute } from 'next';
import { headers } from 'next/headers';

import { isLoopbackHost } from '@/lib/util.host';
import { getRequestHost, isStorefrontHost } from '@/lib/util.storefront-host';

// Paths that hold nothing indexable. Storefront funnels (customer sessions,
// checkout, one-shot links) leak funnel URLs into search results; the
// dashboard/auth surface shares the host in standalone mode, so it must be
// listed here too — the platform dashboard host gets a disallow-all instead.
// Product images (/files/…) stay crawlable on purpose.
const PRIVATE_PATHS = [
  '/api/',
  // Storefront funnels
  '/account',
  '/checkout',
  '/pay/',
  '/authorize-deposit/',
  '/confirmation/',
  '/r/',
  '/review',
  '/embed',
  // Dashboard/auth surface (path-routed in standalone mode)
  '/dashboard',
  '/login',
  '/register',
  '/onboarding',
  '/invitation',
  '/multi-store',
  '/admin',
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Dashboard, www and apex hosts: private application surface, and on a
  // platform deployment the dashboard also mirrors every storefront under
  // /{slug}. Keep the whole host out of the index.
  if (!(await isStorefrontHost())) {
    return {
      rules: { userAgent: '*', disallow: '/' },
    };
  }

  const headerStore = await headers();
  const host = await getRequestHost();
  const forwardedProtocol = headerStore
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim();
  const protocol =
    forwardedProtocol || (isLoopbackHost(host.split(':')[0]) ? 'http' : 'https');

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: PRIVATE_PATHS,
    },
    sitemap: `${protocol}://${host}/sitemap.xml`,
  };
}
