import { notFound, redirect } from 'next/navigation';

import { and, eq, inArray, ne } from 'drizzle-orm';
import { getTranslations } from 'next-intl/server';

import { db } from '@louez/db';
import {
  categories,
  getBlockingReservationStatuses,
  products,
  reservationItemUnits,
  reservationItems,
  reservations,
} from '@louez/db';

import { DashboardBreadcrumbLabel } from '@/components/dashboard/dashboard-breadcrumbs-context';

import { getCurrentStore } from '@/lib/store-context';

import { ProductForm } from '../product-form';

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({
  params,
}: EditProductPageProps) {
  const t = await getTranslations('dashboard.products');
  const store = await getCurrentStore();

  if (!store) {
    redirect('/onboarding');
  }

  const { id } = await params;

  const product = await db.query.products.findFirst({
    where: and(eq(products.id, id), eq(products.storeId, store.id)),
    with: {
      category: true,
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

  const categoriesList = await db.query.categories.findMany({
    where: eq(categories.storeId, store.id),
    orderBy: [categories.order],
  });

  // Get all active products for the accessories selector (excluding current product)
  const availableAccessories = await db.query.products.findMany({
    where: and(
      eq(products.storeId, store.id),
      eq(products.status, 'active'),
      ne(products.id, id),
    ),
    columns: {
      id: true,
      name: true,
      price: true,
      images: true,
    },
    orderBy: (p, { asc }) => [asc(p.name)],
  });

  // Extract accessory IDs for the form
  const accessoryIds = product.accessories.map((a) => a.accessoryId);
  const unitIds = product.units.map((unit) => unit.id);
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
          .innerJoin(
            reservations,
            eq(reservationItems.reservationId, reservations.id),
          )
          .where(
            and(
              inArray(reservationItemUnits.productUnitId, unitIds),
              eq(reservations.storeId, store.id),
              inArray(reservations.status, blockingStatuses),
            ),
          )
      : [];
  const assignedUnitIds = new Set(
    assignedUnitRows.map((row) => row.productUnitId),
  );

  return (
    <div className="space-y-6">
      <DashboardBreadcrumbLabel label={product.name} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t('editProduct')}
        </h1>
        <p className="text-muted-foreground">{t('editProductDescription')}</p>
      </div>

      <ProductForm
        product={{
          ...product,
          accessoryIds,
          units: product.units.map((unit) => ({
            id: unit.id,
            identifier: unit.identifier,
            attributes: unit.attributes,
            hasActiveAssignment: assignedUnitIds.has(unit.id),
          })),
        }}
        categories={categoriesList}
        storeTaxSettings={store.settings?.tax}
        availableAccessories={availableAccessories}
      />
    </div>
  );
}
