import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";

import { db, stores } from "@louez/db";

import { env } from "@/env";
import { getStorefrontUrl } from "@/lib/storefront-url";

import { EmbedPlayground } from "./embed-playground";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Widget embed · Dev",
  robots: {
    index: false,
    follow: false,
  },
};

/** Long enough to cover a local database, short enough to stay a picker. */
const STORE_LIMIT = 50;

/**
 * Bench for the embeddable date picker: it frames the real `/embed` route of a
 * real store, the way a merchant site would, so integration, screen width and
 * the resize handshake can be checked without leaving the app.
 */
export default async function EmbedDevPage() {
  // The bench points at live stores and exposes their embed URLs: local only.
  if (env.NODE_ENV !== "development") {
    notFound();
  }

  const storeRows = await db
    .select({ name: stores.name, slug: stores.slug })
    .from(stores)
    .orderBy(asc(stores.name))
    .limit(STORE_LIMIT);

  if (storeRows.length === 0) {
    return (
      <main className="flex h-dvh items-center justify-center p-6 text-sm text-muted-foreground">
        Aucune boutique dans cette base : créez-en une pour tester le widget.
      </main>
    );
  }

  const playgroundStores = storeRows.map((store) => ({
    ...store,
    embedUrl: getStorefrontUrl(store.slug, "/embed"),
  }));

  return <EmbedPlayground stores={playgroundStores} />;
}
