import "server-only";

import type { Viewport } from "next";
import { cacheLife, cacheTag, revalidateTag } from "next/cache";
import { and, eq } from "drizzle-orm";

import { db, stores } from "@louez/db";

import { STORE_THEME_VIEWPORT_COLORS } from "@/lib/theme/util.store-theme";

const viewportTag = (slug: string) => `storefront-viewport:${slug}`;

/** Cache only public viewport data; the store's operational settings stay fresh. */
export const getStoreViewport = async (slug: string): Promise<Viewport> => {
  "use cache";

  cacheLife("hours");
  cacheTag(viewportTag(slug));

  const store = await db.query.stores.findFirst({
    columns: { theme: true },
    where: and(eq(stores.slug, slug), eq(stores.onboardingCompleted, true)),
  });
  const mode = store?.theme?.mode === "dark" ? "dark" : "light";

  return {
    themeColor: STORE_THEME_VIEWPORT_COLORS[mode],
    width: "device-width",
    initialScale: 1,
  };
};

export const invalidateStoreViewport = (slug: string): void => {
  revalidateTag(viewportTag(slug), { expire: 0 });
};
