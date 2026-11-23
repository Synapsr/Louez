"use server";

import { revalidatePath } from "next/cache";

import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db, productBundleItems, productBundles, products } from "@louez/db";

import { getCurrentStore } from "@/lib/store-context";

const bundleItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(999),
});

const createBundleInputSchema = z.object({
  name: z.string().trim().min(1, "Podaj nazwę zestawu").max(255),
  description: z.string().trim().max(2000).optional().nullable(),
  isActive: z.boolean().default(true),
  items: z.array(bundleItemInputSchema).min(1, "Dodaj co najmniej jeden produkt do zestawu"),
});

const updateBundleInputSchema = createBundleInputSchema.extend({
  id: z.string().min(1),
});

export interface DashboardBundleProductOption {
  id: string;
  name: string;
  price: string;
  quantity: number;
  images: string[];
  status: string;
}

export interface DashboardProductBundleItem {
  id: string;
  productId: string;
  quantity: number;
  displayOrder: number;
  productName: string;
  productPrice: string;
  productImages: string[];
}

export interface DashboardProductBundle {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  displayOrder: number;
  items: DashboardProductBundleItem[];
}

export async function listProductBundlesData(): Promise<{
  bundles: DashboardProductBundle[];
  availableProducts: DashboardBundleProductOption[];
}> {
  const store = await getCurrentStore();
  if (!store) {
    throw new Error("Brak autoryzacji lub wybranego sklepu");
  }

  const [bundleRows, storeProducts] = await Promise.all([
    db.query.productBundles.findMany({
      where: eq(productBundles.storeId, store.id),
      orderBy: [asc(productBundles.displayOrder), asc(productBundles.createdAt)],
      with: {
        items: {
          orderBy: [asc(productBundleItems.displayOrder)],
          with: {
            product: {
              columns: {
                id: true,
                name: true,
                price: true,
                images: true,
              },
            },
          },
        },
      },
    }),
    db.query.products.findMany({
      where: and(eq(products.storeId, store.id), eq(products.status, "active")),
      orderBy: [asc(products.displayOrder), asc(products.name)],
      columns: {
        id: true,
        name: true,
        price: true,
        quantity: true,
        images: true,
        status: true,
      },
    }),
  ]);

  const bundles: DashboardProductBundle[] = bundleRows.map((bundle) => ({
    id: bundle.id,
    name: bundle.name,
    description: bundle.description ?? null,
    isActive: bundle.isActive,
    displayOrder: bundle.displayOrder,
    items: bundle.items
      .filter((item) => Boolean(item.product))
      .map((item) => ({
        id: item.id,
        productId: item.productId,
        quantity: item.quantity,
        displayOrder: item.displayOrder,
        productName: item.product.name,
        productPrice: String(item.product.price),
        productImages: Array.isArray(item.product.images) ? item.product.images : [],
      })),
  }));

  const availableProducts: DashboardBundleProductOption[] = storeProducts.map((product) => ({
    id: product.id,
    name: product.name,
    price: String(product.price),
    quantity: product.quantity,
    images: Array.isArray(product.images) ? product.images : [],
    status: product.status ?? "active",
  }));

  return { bundles, availableProducts };
}

function deduplicateBundleItems(
  items: Array<{ productId: string; quantity: number }>,
): Array<{ productId: string; quantity: number }> {
  const map = new Map<string, number>();
  for (const item of items) {
    map.set(item.productId, (map.get(item.productId) ?? 0) + item.quantity);
  }
  return Array.from(map.entries()).map(([productId, quantity]) => ({
    productId,
    quantity,
  }));
}

export async function createProductBundleAction(
  rawInput: z.infer<typeof createBundleInputSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await getCurrentStore();
    if (!store) {
      return { success: false, error: "Brak autoryzacji" };
    }

    const parsed = createBundleInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane zestawu",
      };
    }

    const normalizedItems = deduplicateBundleItems(parsed.data.items);
    const productIds = normalizedItems.map((item) => item.productId);

    const ownedProducts = await db.query.products.findMany({
      where: and(eq(products.storeId, store.id), inArray(products.id, productIds)),
      columns: { id: true },
    });

    if (ownedProducts.length !== productIds.length) {
      return {
        success: false,
        error: "Jeden lub więcej wybranych produktów nie należy do tego sklepu",
      };
    }

    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(productBundles)
        .values({
          storeId: store.id,
          name: parsed.data.name,
          description: parsed.data.description?.trim() || null,
          isActive: parsed.data.isActive,
        })
        .$returningId();

      if (!inserted?.id) {
        throw new Error("Nie udało się utworzyć zestawu");
      }

      await tx.insert(productBundleItems).values(
        normalizedItems.map((item, index) => ({
          bundleId: inserted.id,
          productId: item.productId,
          quantity: item.quantity,
          displayOrder: index,
        })),
      );
    });

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/reservations/new");
    revalidatePath(`/${store.slug}`, "layout");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Wystąpił błąd podczas tworzenia zestawu",
    };
  }
}

export async function updateProductBundleAction(
  rawInput: z.infer<typeof updateBundleInputSchema>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await getCurrentStore();
    if (!store) {
      return { success: false, error: "Brak autoryzacji" };
    }

    const parsed = updateBundleInputSchema.safeParse(rawInput);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane zestawu",
      };
    }

    const existing = await db.query.productBundles.findFirst({
      where: and(eq(productBundles.id, parsed.data.id), eq(productBundles.storeId, store.id)),
      columns: { id: true },
    });

    if (!existing) {
      return { success: false, error: "Nie znaleziono zestawu" };
    }

    const normalizedItems = deduplicateBundleItems(parsed.data.items);
    const productIds = normalizedItems.map((item) => item.productId);

    const ownedProducts = await db.query.products.findMany({
      where: and(eq(products.storeId, store.id), inArray(products.id, productIds)),
      columns: { id: true },
    });

    if (ownedProducts.length !== productIds.length) {
      return {
        success: false,
        error: "Jeden lub więcej wybranych produktów nie należy do tego sklepu",
      };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(productBundles)
        .set({
          name: parsed.data.name,
          description: parsed.data.description?.trim() || null,
          isActive: parsed.data.isActive,
          updatedAt: new Date(),
        })
        .where(and(eq(productBundles.id, existing.id), eq(productBundles.storeId, store.id)));

      await tx.delete(productBundleItems).where(eq(productBundleItems.bundleId, existing.id));

      await tx.insert(productBundleItems).values(
        normalizedItems.map((item, index) => ({
          bundleId: existing.id,
          productId: item.productId,
          quantity: item.quantity,
          displayOrder: index,
        })),
      );
    });

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/reservations/new");
    revalidatePath(`/${store.slug}`, "layout");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Wystąpił błąd podczas zapisywania zestawu",
    };
  }
}

export async function deleteProductBundleAction(
  bundleId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const store = await getCurrentStore();
    if (!store) {
      return { success: false, error: "Brak autoryzacji" };
    }

    await db
      .delete(productBundles)
      .where(and(eq(productBundles.id, bundleId), eq(productBundles.storeId, store.id)));

    revalidatePath("/dashboard/products");
    revalidatePath("/dashboard/reservations/new");
    revalidatePath(`/${store.slug}`, "layout");
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Wystąpił błąd podczas usuwania zestawu",
    };
  }
}
