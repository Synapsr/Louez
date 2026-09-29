"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@louez/ui";
import { ProductSolidIcon } from "@louez/ui/icons";
import { formatCurrency } from "@louez/utils";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";

interface TopProduct {
  productId: string | null;
  productName: string;
  totalQuantity: number;
  totalRevenue: string;
  reservationCount: number;
}

interface TopProductsTableProps {
  products: TopProduct[];
  /** Allocated receipts of every product over the period, top 10 or not. */
  catalogRevenue: number;
  totalRevenue: number;
  nonCatalogRevenue: number;
  unallocatedRevenue: number;
  /** Distinct products that brought receipts over the period. */
  productCount: number;
  readOnly?: boolean;
}

/** Gold / silver / bronze for the podium, muted numbers below. */
const RANK_VARIANTS = ["review", "expired", "pending"] as const;

export const TopProductsTable = ({
  products,
  catalogRevenue,
  totalRevenue,
  nonCatalogRevenue,
  unallocatedRevenue,
  productCount,
  readOnly = false,
}: TopProductsTableProps) => {
  const t = useTranslations("dashboard.statistics");

  if (products.length === 0 && totalRevenue === 0) {
    return <DashboardEmptyState icon={ProductSolidIcon} description={t("noRentalData")} />;
  }

  // What the ten rows leave out, so the footer adds up to the receipts KPI.
  const othersCount = Math.max(productCount - products.length, 0);
  const othersRevenue =
    catalogRevenue -
    products.reduce(
      (sum, product) => sum + Math.round(parseFloat(product.totalRevenue) * 100) / 100,
      0,
    );

  return (
    <div data-demo-target="analytics-top-products" className="-mx-1 overflow-x-auto px-1">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12.5">#</TableHead>
            <TableHead>{t("topProducts.product")}</TableHead>
            <TableHead className="text-center">{t("topProducts.rentals")}</TableHead>
            <TableHead className="hidden text-center md:table-cell">
              {t("topProducts.totalQuantity")}
            </TableHead>
            <TableHead className="text-right">{t("topProducts.revenue")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product, index) => (
            <TableRow key={product.productId}>
              <TableCell className="font-medium">
                {index < RANK_VARIANTS.length ? (
                  <Badge variant={RANK_VARIANTS[index]} className="tabular-nums">
                    {index + 1}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground tabular-nums">{index + 1}</span>
                )}
              </TableCell>
              <TableCell className="max-w-55">
                <Link
                  href={readOnly ? "#" : `/dashboard/products/${product.productId}`}
                  prefetch={readOnly ? false : undefined}
                  onClick={readOnly ? (event) => event.preventDefault() : undefined}
                  aria-disabled={readOnly || undefined}
                  className="block truncate font-medium hover:underline"
                >
                  {product.productName}
                </Link>
              </TableCell>
              <TableCell className="text-center">
                <Badge variant="expired" className="tabular-nums">
                  {product.reservationCount}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground hidden text-center md:table-cell">
                {t("topProducts.units", { count: product.totalQuantity })}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                {formatCurrency(parseFloat(product.totalRevenue))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          {othersCount > 0 && (
            <TableRow>
              <TableCell colSpan={3} className="text-muted-foreground font-normal">
                {t("topProducts.othersRow", { count: othersCount })}
              </TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="text-muted-foreground text-right font-normal tabular-nums whitespace-nowrap">
                {formatCurrency(othersRevenue)}
              </TableCell>
            </TableRow>
          )}
          {nonCatalogRevenue !== 0 && (
            <TableRow>
              <TableCell colSpan={3}>{t("topProducts.nonCatalog")}</TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="text-right tabular-nums whitespace-nowrap">
                {formatCurrency(nonCatalogRevenue)}
              </TableCell>
            </TableRow>
          )}
          {unallocatedRevenue !== 0 && (
            <TableRow>
              <TableCell colSpan={3}>{t("topProducts.unallocated")}</TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell className="text-right tabular-nums whitespace-nowrap">
                {formatCurrency(unallocatedRevenue)}
              </TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell colSpan={3}>{t("topProducts.totalRow")}</TableCell>
            <TableCell className="hidden md:table-cell" />
            <TableCell className="text-right tabular-nums whitespace-nowrap">
              {formatCurrency(totalRevenue)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
};
