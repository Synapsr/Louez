import { redirect } from 'next/navigation';

import { asc, eq } from 'drizzle-orm';

import { db, effectiveProductQuantitySql, products } from '@louez/db';
import type { GetInventoryInput } from '@louez/validations';

import { getCurrentStore } from '@/lib/store-context';

import { InventoryPageContent } from './components/inventory-page-content';
import type { InventoryProductOption } from './components/inventory-types';
import { isInventoryStateOption } from './components/inventory.constants';
import { getInventory } from './queries';

interface InventoryPageProps {
  searchParams: Promise<{
    productId?: string;
    state?: string;
    search?: string;
    page?: string;
  }>;
}

const parseInventoryState = (
  value: string | undefined,
): GetInventoryInput['state'] => {
  if (!value) {
    return undefined;
  }

  return isInventoryStateOption(value) ? value : undefined;
};

const parsePage = (value: string | undefined) => {
  const page = value ? parseInt(value, 10) : 1;
  return Number.isInteger(page) && page > 0 ? page : 1;
};

const parseProductId = (value: string | undefined) => {
  return value && /^[A-Za-z0-9_-]{21}$/.test(value) ? value : undefined;
};

const parseSearch = (value: string | undefined) => {
  return value?.trim().slice(0, 100) || undefined;
};

const getProductOptions = async (
  storeId: string,
): Promise<InventoryProductOption[]> => {
  return db
    .select({
      id: products.id,
      name: products.name,
      trackUnits: products.trackUnits,
      quantity: effectiveProductQuantitySql(),
    })
    .from(products)
    .where(eq(products.storeId, storeId))
    .orderBy(asc(products.name));
};

export default async function InventoryPage({
  searchParams,
}: InventoryPageProps) {
  const store = await getCurrentStore();
  if (!store) {
    redirect('/onboarding');
  }

  const params = await searchParams;
  const state = parseInventoryState(params.state);
  const page = parsePage(params.page);
  const productId = parseProductId(params.productId);
  const search = parseSearch(params.search);

  const [inventory, productOptions] = await Promise.all([
    getInventory({
      productId,
      state,
      search,
      page,
    }),
    getProductOptions(store.id),
  ]);

  return (
    <InventoryPageContent
      rows={inventory.success ? inventory.rows : []}
      total={inventory.success ? inventory.total : 0}
      page={inventory.success ? inventory.page : page}
      pageSize={inventory.success ? inventory.pageSize : 50}
      products={productOptions}
      currentProductId={productId}
      currentState={state}
      currentSearch={search}
      currency={store.settings?.currency}
    />
  );
}
