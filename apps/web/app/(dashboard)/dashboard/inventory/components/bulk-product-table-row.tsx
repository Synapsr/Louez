'use client';

import Link from 'next/link';

import { Package } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge, Button, TableCell, TableRow } from '@louez/ui';

import type { InventoryBulkProductRow } from '../queries';
import { ProductThumbnail } from './product-thumbnail';

interface BulkProductTableRowProps {
  row: InventoryBulkProductRow;
}

export const BulkProductTableRow = ({ row }: BulkProductTableRowProps) => {
  const t = useTranslations('dashboard.inventory');

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-2">
          <Package className="text-muted-foreground h-4 w-4" />
          <span className="font-medium">{t('bulk.bulkProduct')}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <ProductThumbnail src={row.productImage} alt={row.productName} />
          <div className="min-w-0 space-y-1">
            <Link
              href={`/dashboard/products/${row.productId}`}
              className="font-medium hover:underline"
            >
              {row.productName}
            </Link>
            <p className="text-muted-foreground text-xs">
              {t('bulk.trackingDisabled')}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="secondary">
          {t('bulk.quantity', { count: row.quantity })}
        </Badge>
      </TableCell>
      <TableCell>
        <span className="text-muted-foreground text-sm">
          {t('bulk.availabilityInfo')}
        </span>
      </TableCell>
      <TableCell className="text-center">-</TableCell>
      <TableCell>
        <Button
          variant="outline"
          size="sm"
          render={
            <Link href={`/dashboard/products/${row.productId}#section-stock`} />
          }
        >
          {t('bulk.enableTracking')}
        </Button>
      </TableCell>
    </TableRow>
  );
};
