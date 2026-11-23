import "server-only";

import { and, asc, eq } from "drizzle-orm";

import {
  db,
  getEffectiveProductQuantities,
  productAccessories,
  productBundleItems,
  productBundles,
} from "@louez/db";

import type { AccessoryLink, StorefrontCatalogProduct } from "@/lib/storefront/storefront.types";

export interface StorefrontProductBundleItem {
  id: string;
  quantity: number;
  product: StorefrontCatalogProduct;
}

export interface StorefrontProductBundle {
  id: string;
  name: string;
  description: string | null;
  items: StorefrontProductBundleItem[];
}

export async function loadStorefrontBundles(storeId: string): Promise<StorefrontProductBundle[]> {
  const rows = await db.query.productBundles.findMany({
    where: and(eq(productBundles.storeId, storeId), eq(productBundles.isActive, true)),
    orderBy: [asc(productBundles.displayOrder), asc(productBundles.createdAt)],
    with: {
      items: {
        orderBy: [asc(productBundleItems.displayOrder)],
        with: {
          product: {
            with: {
              pricingTiers: true,
              accessories: {
                orderBy: [asc(productAccessories.displayOrder)],
                with: {
                  accessory: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (rows.length === 0) {
    return [];
  }

  const allProducts = rows.flatMap((bundle) =>
    bundle.items.map((item) => item.product).filter(Boolean),
  );
  const trackedProductIds = Array.from(
    new Set(allProducts.filter((product) => product.trackUnits).map((product) => product.id)),
  );
  const effectiveQuantities =
    trackedProductIds.length > 0
      ? await getEffectiveProductQuantities(db, trackedProductIds)
      : new Map<string, number>();

  return rows
    .map((bundle) => {
      const activeItems: StorefrontProductBundleItem[] = bundle.items
        .filter((item) => item.product && item.product.status === "active")
        .map((item) => {
          const p = item.product;
          const effectiveQty = p.trackUnits
            ? (effectiveQuantities.get(p.id) ?? 0)
            : p.stockKind === "untracked"
              ? null
              : p.quantity;

          const accessories: AccessoryLink[] = (p.accessories ?? [])
            .filter((acc) => acc.accessory && acc.accessory.status === "active")
            .map((acc) => ({
              id: acc.accessory.id,
              name: acc.accessory.name,
              slug: acc.accessory.slug,
              price: String(acc.accessory.price),
              deposit: String(acc.accessory.deposit ?? "0"),
              images: Array.isArray(acc.accessory.images) ? acc.accessory.images : [],
              quantity:
                acc.accessory.stockKind === "untracked" ? null : acc.accessory.quantity,
              stockKind: acc.accessory.stockKind,
              pricingKind: acc.accessory.pricingKind,
              pricingMode: acc.accessory.pricingMode,
              basePeriodMinutes: acc.accessory.basePeriodMinutes,
              required: acc.required,
              requiredQuantity: acc.quantity,
            }));

          const catalogProduct: StorefrontCatalogProduct = {
            id: p.id,
            name: p.name,
            slug: p.slug,
            description: p.description,
            images: Array.isArray(p.images) ? p.images : [],
            price: String(p.price),
            deposit: p.deposit ? String(p.deposit) : null,
            quantity: effectiveQty,
            stockKind: p.stockKind,
            pricingKind: p.pricingKind,
            pricingMode: p.pricingMode,
            basePeriodMinutes: p.basePeriodMinutes,
            enforceStrictTiers: p.enforceStrictTiers,
            priceNegotiable: p.priceNegotiable,
            pricingTiers: (p.pricingTiers ?? []).map((tier) => ({
              id: tier.id,
              minDuration: tier.minDuration,
              discountPercent: tier.discountPercent,
              period: tier.period,
              price: tier.price,
              displayOrder: tier.displayOrder,
            })),
            accessories,
          };

          return {
            id: item.id,
            quantity: item.quantity,
            product: catalogProduct,
          };
        });

      return {
        id: bundle.id,
        name: bundle.name,
        description: bundle.description ?? null,
        items: activeItems,
      };
    })
    .filter((bundle) => bundle.items.length > 0);
}
