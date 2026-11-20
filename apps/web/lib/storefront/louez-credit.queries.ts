import "server-only";

import { and, eq } from "drizzle-orm";

import { categories, db, productCategories, products } from "@louez/db";

import type { StorefrontStore } from "@/lib/storefront/get-store-by-slug";
import { isSelfHosted } from "@/lib/hosting";
import {
  detectStoreTrade,
  isFrenchStore,
  type LouezCreditTarget,
  type TradeProduct,
} from "@/lib/storefront/util.louez-credit";

const readActiveProducts = async (storeId: string): Promise<TradeProduct[]> => {
  const activeProductsOf = and(eq(products.storeId, storeId), eq(products.status, "active"));
  const [rows, links] = await Promise.all([
    db.select({ id: products.id, name: products.name }).from(products).where(activeProductsOf),
    db
      .select({ productId: productCategories.productId, name: categories.name })
      .from(productCategories)
      .innerJoin(products, eq(products.id, productCategories.productId))
      .innerJoin(categories, eq(categories.id, productCategories.categoryId))
      .where(activeProductsOf),
  ]);

  const categoryNamesByProductId = new Map<string, string[]>();
  for (const link of links) {
    const names = categoryNamesByProductId.get(link.productId) ?? [];
    names.push(link.name);
    categoryNamesByProductId.set(link.productId, names);
  }
  return rows.map((row) => ({
    name: row.name,
    categoryNames: categoryNamesByProductId.get(row.id) ?? [],
  }));
};

/**
 * What the footer credit of a Louez Cloud storefront links, or null on a self-hosted
 * instance, whose credit stays the plain louez.io link: the trade pages promote Louez
 * Cloud, and the operator did not choose that for its customers' storefronts.
 */
export async function loadLouezCreditTarget(
  store: Pick<StorefrontStore, "id" | "settings">,
): Promise<LouezCreditTarget | null> {
  if (isSelfHosted()) return null;
  return {
    trade: detectStoreTrade(await readActiveProducts(store.id)),
    fallbackLocale: isFrenchStore(store.settings) ? "fr" : "en",
  };
}
