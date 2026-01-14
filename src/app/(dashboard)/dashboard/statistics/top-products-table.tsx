'use client'

import Link from 'next/link'
import { Package } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'

interface TopProduct {
  productId: string | null
  productName: string
  totalQuantity: number
  totalRevenue: string
  reservationCount: number
}

interface TopProductsTableProps {
  products: TopProduct[]
}

export function TopProductsTable({ products }: TopProductsTableProps) {
  const t = useTranslations('dashboard.statistics')

  if (products.length === 0) {
    return (
      <div className="flex h-[200px] flex-col items-center justify-center text-muted-foreground">
        <Package className="mb-2 h-8 w-8" />
        <p>{t('noRentalData')}</p>
      </div>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-[50px]">#</TableHead>
          <TableHead>{t('topProducts.product')}</TableHead>
          <TableHead className="text-center">{t('topProducts.rentals')}</TableHead>
          <TableHead className="text-center">{t('topProducts.totalQuantity')}</TableHead>
          <TableHead className="text-right">{t('topProducts.revenue')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {products.map((product, index) => (
          <TableRow key={product.productId}>
            <TableCell className="font-medium">
              {index < 3 ? (
                <Badge
                  variant={index === 0 ? 'default' : 'secondary'}
                  className={
                    index === 0
                      ? 'bg-yellow-500'
                      : index === 1
                        ? 'bg-gray-400'
                        : 'bg-amber-600'
                  }
                >
                  {index + 1}
                </Badge>
              ) : (
                <span className="text-muted-foreground">{index + 1}</span>
              )}
            </TableCell>
            <TableCell>
              <Link
                href={`/dashboard/products/${product.productId}`}
                className="font-medium hover:underline"
              >
                {product.productName}
              </Link>
            </TableCell>
            <TableCell className="text-center">
              <Badge variant="outline">{product.reservationCount}</Badge>
            </TableCell>
            <TableCell className="text-center text-muted-foreground">
              {t('topProducts.units', { count: product.totalQuantity })}
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatCurrency(parseFloat(product.totalRevenue))}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
