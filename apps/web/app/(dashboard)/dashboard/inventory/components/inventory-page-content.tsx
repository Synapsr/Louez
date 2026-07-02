import type { InventoryRow } from '../queries';
import { InventoryEmptyState } from './inventory-empty-state';
import { InventoryFilters } from './inventory-filters';
import { InventoryHeader } from './inventory-header';
import { InventoryTable } from './inventory-table';
import type { InventoryProductOption } from './inventory-types';

interface InventoryPageContentProps {
  rows: InventoryRow[];
  total: number;
  page: number;
  pageSize: number;
  products: InventoryProductOption[];
  currentProductId?: string;
  currentState?: string;
  currentSearch?: string;
  currency?: string;
}

export const InventoryPageContent = ({
  rows,
  total,
  page,
  pageSize,
  products,
  currentProductId,
  currentState,
  currentSearch,
  currency,
}: InventoryPageContentProps) => {
  const hasProducts = products.length > 0;
  const hasTrackedProducts = products.some((product) => product.trackUnits);
  const hasActiveFilters =
    Boolean(currentProductId) ||
    Boolean(currentState) ||
    Boolean(currentSearch);

  return (
    <div className="space-y-4 sm:space-y-6">
      <InventoryHeader />

      {!hasProducts ? (
        <InventoryEmptyState variant="no-products" />
      ) : (
        <>
          {!hasTrackedProducts && !hasActiveFilters ? (
            <InventoryEmptyState variant="tracked-empty" />
          ) : null}

          <InventoryFilters
            products={products}
            currentProductId={currentProductId}
            currentState={currentState}
            currentSearch={currentSearch}
          />

          {rows.length === 0 ? (
            <InventoryEmptyState variant="no-results" />
          ) : (
            <InventoryTable
              rows={rows}
              total={total}
              page={page}
              pageSize={pageSize}
              currency={currency}
            />
          )}
        </>
      )}
    </div>
  );
};
