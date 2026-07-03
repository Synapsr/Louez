'use client';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { Badge } from '@louez/ui';

import type { InventoryUnitRow } from '../queries';
import { ProductThumbnail } from './product-thumbnail';
import { formatUnitAttributes } from './util.inventory-format';

interface ProductCellProps {
  row: InventoryUnitRow;
}

export const ProductCell = ({ row }: ProductCellProps) => {
  const t = useTranslations('dashboard.inventory');
  const attributes = formatUnitAttributes(row.attributes);

  return (
    <div className="flex items-center gap-3">
      <ProductThumbnail src={row.productImage} alt={row.productName} />
      <div className="min-w-0 space-y-1">
        <Link
          href={`/dashboard/products/${row.productId}`}
          className="font-medium hover:underline"
        >
          {row.productName}
        </Link>
        {attributes ? (
          <p className="text-muted-foreground text-xs">{attributes}</p>
        ) : null}
        {row.counters.reservedWithoutAssignment > 0 ? (
          <Badge variant="secondary">
            {t('counters.reservedWithoutAssignedUnit', {
              count: row.counters.reservedWithoutAssignment,
            })}
          </Badge>
        ) : null}
      </div>
    </div>
  );
};
