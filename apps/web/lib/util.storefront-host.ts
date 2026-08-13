import { headers } from 'next/headers';

import { and, asc, eq } from 'drizzle-orm';

import { db, stores } from '@louez/db';

import { isStandaloneMode } from '@/lib/deployment';
import { getSubdomain, isLoopbackHost } from '@/lib/util.host';

import { env } from '@/env';

/**
 * The host the visitor typed.
 *
 * `host` is the last hop, which local HTTPS proxies and production ingresses
 * rewrite to their upstream (`localhost:60441`, …); `x-forwarded-host` is the
 * original one and wins whenever it is present.
 */
export async function getRequestHost(): Promise<string> {
  const headerStore = await headers();

  return (
    headerStore.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    headerStore.get('host') ||
    ''
  );
}

/**
 * The store subdomain of the incoming host, or null when the host is not a
 * store subdomain (dashboard, www, apex, localhost). Single owner of the
 * "which hosts are storefronts" rule — robots.txt, the sitemap and link
 * prefixes must all agree on it.
 */
async function getStorefrontSubdomain(): Promise<string | null> {
  const subdomain = getSubdomain(await getRequestHost());

  if (
    !subdomain ||
    subdomain === 'www' ||
    subdomain === env.NEXT_PUBLIC_DASHBOARD_SUBDOMAIN
  ) {
    return null;
  }

  return subdomain;
}

/**
 * Whether the incoming host serves a storefront at its root.
 *
 * Standalone instances always do. On a platform deployment only store
 * subdomains qualify: the dashboard subdomain also renders every storefront
 * under `/{slug}`, but those URLs are duplicates of the canonical store
 * subdomain and must stay out of search results.
 *
 * Cheap on purpose — no database round-trip, so robots.txt stays a pure
 * header read.
 */
export async function isStorefrontHost(): Promise<boolean> {
  if (isStandaloneMode()) {
    return true;
  }

  return Boolean(await getStorefrontSubdomain());
}

/**
 * Prefix for storefront links rendered on the current host.
 *
 * On the store's own subdomain, in standalone mode and in local preview mode
 * the proxy injects the slug, so links must stay slug-less: `/catalog`. On
 * other hosts — dashboard or localhost path-based routing, which serve the
 * same pages under `/{slug}` — they need the prefix: `/ddm/catalog`. A
 * slugged link on a store subdomain 404s (`/ddm/ddm/catalog`), which is why
 * this cannot be hardcoded.
 *
 * Server-side twin of the `useStorefrontUrl().getUrl` client hook.
 */
export async function getStorefrontPathPrefix(slug: string): Promise<string> {
  if (isStandaloneMode()) {
    return '';
  }

  const host = await getRequestHost();

  // Local preview (PREVIEW_STORE_SLUG): the proxy serves this store slug-less
  // at the localhost root, mirroring a subdomain.
  if (
    env.PREVIEW_STORE_SLUG === slug &&
    isLoopbackHost(host.split(':')[0].toLowerCase())
  ) {
    return '';
  }

  const subdomain = getSubdomain(host);

  return subdomain?.toLowerCase() === slug.toLowerCase() ? '' : `/${slug}`;
}

/**
 * The onboarded store served at the root of the incoming host, or null when
 * the host is not a storefront. Standalone instances resolve the same store
 * the proxy serves at the root (the oldest onboarded one).
 */
export async function resolveStoreFromHost() {
  const columns = {
    id: true,
    slug: true,
    name: true,
    updatedAt: true,
  } as const;

  if (isStandaloneMode()) {
    return (
      (await db.query.stores.findFirst({
        columns,
        where: eq(stores.onboardingCompleted, true),
        orderBy: [asc(stores.createdAt)],
      })) ?? null
    );
  }

  const subdomain = await getStorefrontSubdomain();

  if (!subdomain) {
    return null;
  }

  return (
    (await db.query.stores.findFirst({
      columns,
      where: and(
        eq(stores.slug, subdomain),
        eq(stores.onboardingCompleted, true),
      ),
    })) ?? null
  );
}
