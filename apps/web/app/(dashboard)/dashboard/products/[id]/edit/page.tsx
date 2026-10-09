import { notFound, redirect } from "next/navigation";

import { and, eq, inArray } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { getAccessoryCandidates } from "@louez/api/services";
import {
  categories,
  db,
  getBlockingReservationStatuses,
  getEffectiveProductQuantities,
  getProductStockKindChangeBlockers,
  products,
  reservationItemUnits,
  reservationItems,
  reservationStillHoldsUnitsSql,
  reservations,
  variantDefinitions,
} from "@louez/db";
import { findMatchingVariant, getVariantAxisIdentity } from "@louez/utils";

import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";

import { isImageBackgroundRemovalEnabled } from "@/lib/ai/image/background-removal";
import { isAiImageEnhanceEnabled } from "@/lib/ai/image/credits";
import { getCurrentStore } from "@/lib/store-context";
import { inferAttributeAxesFromUnits } from "@/lib/utils/util.variant-combinations";

import { ProductForm } from "../../product-form";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: EditProductPageProps) {
  const [t, tBreadcrumbs] = await Promise.all([
    getTranslations("dashboard.products"),
    getTranslations("dashboard.breadcrumbs"),
  ]);
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const { id } = await params;

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, id), eq(products.storeId, store.id)),
    with: {
      category: true,
      categoryLinks: {
        orderBy: (links, { asc }) => [asc(links.position)],
      },
      pricingTiers: true,
      accessories: {
        orderBy: (acc, { asc }) => [asc(acc.displayOrder)],
        with: {
          accessory: {
            columns: {
              id: true,
              name: true,
              price: true,
              images: true,
            },
          },
        },
      },
      units: {
        orderBy: (units, { asc }) => [asc(units.identifier)],
      },
    },
  });

  if (!product) {
    notFound();
  }

  const [categoriesList, availableAccessories, stockKindChangeBlockers, storeVariants] =
    await Promise.all([
      db.query.categories.findMany({
        where: eq(categories.storeId, store.id),
        orderBy: [categories.order],
      }),
      getAccessoryCandidates({ storeId: store.id, excludeProductId: id }),
      getProductStockKindChangeBlockers(db, { productId: id, storeId: store.id }),
      db
        .select({ key: variantDefinitions.key, label: variantDefinitions.label })
        .from(variantDefinitions)
        .where(eq(variantDefinitions.storeId, store.id)),
    ]);

  // Accessory links carry their booking rules (required + quantity per parent
  // unit), not just the association.
  const accessoryLinks = product.accessories.map((link) => ({
    accessoryId: link.accessoryId,
    required: link.required,
    quantity: link.quantity,
  }));
  const editableUnits = product.units.filter((unit) => unit.lifecycleStatus === "active");
  // A product that never declared axes but whose units carry values is sold by
  // those values on the storefront. The form shows the same axes, so saving
  // keeps them instead of silently dropping the values. Only a value every
  // unit carries becomes an axis: a declared axis requires a value on each
  // unit, and a partial legacy value must not block unrelated edits.
  const storedAxes = product.bookingAttributeAxes ?? [];
  const unitAttributes = editableUnits.map(
    (unit) => (unit.attributes as Record<string, string> | null) ?? {},
  );
  // The product schema accepts at most three axes, with lowercase keys and no
  // two aliases of one variant (`size` and `taille`); values outside that stay
  // orphan values, as before.
  const seenIdentities = new Set<string>();
  const bookingAttributeAxes =
    storedAxes.length > 0
      ? storedAxes
      : inferAttributeAxesFromUnits(unitAttributes.map((attributes) => ({ attributes })))
          .filter(
            (axis) =>
              /^[a-z0-9_-]+$/.test(axis.key) &&
              axis.key.length <= 32 &&
              unitAttributes.every((attributes) => attributes[axis.key]?.trim()),
          )
          .filter((axis) => {
            const identity = getVariantAxisIdentity(axis.key);
            if (seenIdentities.has(identity)) return false;
            seenIdentities.add(identity);
            return true;
          })
          .slice(0, 3)
          .map((axis, position) => ({
            ...axis,
            position,
            label: findMatchingVariant(axis.key, storeVariants)?.label ?? axis.label,
          }));
  const unitIds = editableUnits.map((unit) => unit.id);
  const blockingStatuses = getBlockingReservationStatuses(
    store.settings?.pendingBlocksAvailability ?? true,
  );
  const assignedUnitRows =
    unitIds.length > 0
      ? await db
          .select({ productUnitId: reservationItemUnits.productUnitId })
          .from(reservationItemUnits)
          .innerJoin(
            reservationItems,
            eq(reservationItemUnits.reservationItemId, reservationItems.id),
          )
          .innerJoin(reservations, eq(reservationItems.reservationId, reservations.id))
          .where(
            and(
              inArray(reservationItemUnits.productUnitId, unitIds),
              eq(reservations.storeId, store.id),
              inArray(reservations.status, blockingStatuses),
              reservationStillHoldsUnitsSql(),
            ),
          )
      : [];
  const assignedUnitIds = new Set(
    assignedUnitRows.flatMap((row) => (row.productUnitId ? [row.productUnitId] : [])),
  );
  const effectiveQuantities = await getEffectiveProductQuantities(db, [product.id]);
  const effectiveQuantity = product.trackUnits
    ? (effectiveQuantities.get(product.id) ?? 0)
    : product.quantity;
  const showAiContext = store.aiAdvisorSettings?.enabled === true;

  return (
    <div className="space-y-6">
      <DashboardBreadcrumbLabel
        pathname={`/dashboard/products/${product.id}`}
        label={product.name}
      />
      <DashboardBreadcrumbLabel label={tBreadcrumbs("productsEdit")} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("editProduct")}</h1>
        <p className="text-muted-foreground">{t("editProductDescription")}</p>
      </div>

      <ProductForm
        key={product.id}
        stockKindChangeBlockers={stockKindChangeBlockers}
        product={{
          ...product,
          quantity: effectiveQuantity,
          accessories: accessoryLinks,
          categoryIds: product.categoryLinks.map((link) => link.categoryId),
          bookingAttributeAxes,
          units: editableUnits.map((unit) => ({
            id: unit.id,
            identifier: unit.identifier,
            attributes: unit.attributes,
            hasActiveAssignment: assignedUnitIds.has(unit.id),
          })),
        }}
        categories={categoriesList}
        storeTaxSettings={store.settings?.tax}
        currency={store.settings?.currency ?? "EUR"}
        storeTimezone={store.settings?.timezone}
        availableAccessories={availableAccessories}
        showAiContext={showAiContext}
        imageEnhanceEnabled={isAiImageEnhanceEnabled()}
        imageBackgroundRemovalEnabled={isImageBackgroundRemovalEnabled()}
      />
    </div>
  );
}
