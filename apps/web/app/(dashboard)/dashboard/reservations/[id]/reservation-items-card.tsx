"use client";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ArrowRight, Calendar, Package, Tag, Truck } from "lucide-react";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@louez/ui";
import { ShieldSolidIcon } from "@louez/ui/icons";
import type { BookingAttributeAxis } from "@louez/types";
import { formatCurrency, formatNumber } from "@louez/utils";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { formatStoreDate } from "@/lib/utils/store-date";

export interface ReservationDisplayItem {
  id: string;
  productId?: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
  selectedAttributes?: Record<string, string> | null;
  productSnapshot?: { name?: string; selectedAttributes?: Record<string, string> | null } | null;
  product?: {
    name: string;
    bookingAttributeAxes?: BookingAttributeAxis[] | null;
    trackUnits?: boolean | null;
  } | null;
  assignedUnits?: { productUnitId: string }[];
}
export interface ReservationItemsDisplay {
  items?: ReservationDisplayItem[];
  taxAmount?: string | null;
  subtotalExclTax?: string | null;
  subtotalAmount: string;
  taxRate?: string | null;
  discountAmount?: string | null;
  promoCodeSnapshot?: { code: string } | null;
  deliveryFee?: string | null;
  depositAmount: string;
}
export const ReservationItemsCard = ({
  reservation,
  startDate,
  endDate,
  storeTimezone,
  durationDays,
  durationHours,
  currency,
  rental,
  insuredProductIds,
  renderUnitAssignment,
}: {
  reservation: ReservationItemsDisplay;
  startDate: Date;
  endDate: Date;
  storeTimezone?: string;
  durationDays: number;
  durationHours: number;
  currency: string;
  rental: number;
  insuredProductIds: ReadonlySet<string>;
  renderUnitAssignment?: (item: ReservationDisplayItem) => ReactNode;
}) => {
  const t = useTranslations("dashboard.reservations");
  const tCommon = useTranslations("common");
  const { intl: formatLocale } = useFormatLocale();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Package className="h-4 w-4" />
          {t("items")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 text-sm">
          <Calendar className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-x-2 gap-y-1 flex-wrap min-w-0">
            <span>{formatStoreDate(startDate, storeTimezone, "SHORT_DATETIME", formatLocale)}</span>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{formatStoreDate(endDate, storeTimezone, "SHORT_DATETIME", formatLocale)}</span>
            <span className="text-muted-foreground">
              ({durationDays > 0 && tCommon("days", { count: durationDays })}
              {durationDays > 0 && durationHours > 0 && ` ${tCommon("and")} `}
              {durationHours > 0 && tCommon("hours", { count: durationHours })})
            </span>
          </div>
        </div>

        <div className="border rounded-lg overflow-x-auto">
          <Table className="min-w-[520px]">
            <TableHeader>
              <TableRow className="bg-muted/30">
                <TableHead>{t("productName")}</TableHead>
                <TableHead className="text-center w-20">{t("productQty")}</TableHead>
                <TableHead className="text-right w-28">{t("productUnitPrice")}</TableHead>
                <TableHead className="text-right w-28">{t("productTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reservation.items || []).map((item) => {
                const itemProductId = typeof item.productId === "string" ? item.productId : null;
                const isTulipInsured =
                  itemProductId !== null && insuredProductIds.has(itemProductId);
                const displayAttributes =
                  item.selectedAttributes || item.productSnapshot?.selectedAttributes || null;
                const attributeLabelsByKey =
                  item.product?.bookingAttributeAxes?.reduce(
                    (acc: Record<string, string>, axis: BookingAttributeAxis) => {
                      acc[axis.key] = axis.label;
                      return acc;
                    },
                    {},
                  ) || null;

                return (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div>
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            {item.productId ? (
                              <Link
                                href={`/dashboard/products/${item.productId}`}
                                target="_blank"
                                className="hover:underline"
                              >
                                {item.productSnapshot?.name || item.product?.name}
                              </Link>
                            ) : (
                              <span>{item.productSnapshot?.name || item.product?.name}</span>
                            )}
                            {isTulipInsured && (
                              <Badge variant="success" className="">
                                <ShieldSolidIcon className="mr-1 h-3 w-3" />
                                {t("tulipInsuredBadge")}
                              </Badge>
                            )}
                          </div>
                          {displayAttributes && Object.keys(displayAttributes).length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(displayAttributes)
                                .filter(([, value]) => Boolean(value && String(value).trim()))
                                .sort(([a], [b]) => a.localeCompare(b, "en"))
                                .map(([key, value]) => (
                                  <Badge
                                    key={`${item.id}-${key}`}
                                    variant="expired"
                                    className="text-xs"
                                  >
                                    {attributeLabelsByKey?.[key] || key}: {String(value).trim()}
                                  </Badge>
                                ))}
                            </div>
                          )}
                        </div>

                        {renderUnitAssignment?.(item)}
                      </div>
                    </TableCell>
                    <TableCell className="text-center align-top pt-4">{item.quantity}</TableCell>
                    <TableCell className="text-right text-muted-foreground align-top pt-4">
                      {formatCurrency(parseFloat(item.unitPrice), currency, formatLocale)}
                      /u
                    </TableCell>
                    <TableCell className="text-right font-medium align-top pt-4">
                      {formatCurrency(parseFloat(item.totalPrice), currency, formatLocale)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>

        {/* Pricing summary */}
        <div className="flex justify-end pt-4">
          <div className="w-full sm:w-64 space-y-2 text-sm">
            {reservation.taxAmount && parseFloat(reservation.taxAmount) > 0 ? (
              <>
                <div className="flex justify-between text-muted-foreground">
                  <span>{t("subtotalExclTax")}</span>
                  <span>
                    {formatCurrency(
                      parseFloat(reservation.subtotalExclTax || reservation.subtotalAmount),
                      currency,
                      formatLocale,
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>
                    {t("taxLine", {
                      rate: formatNumber(parseFloat(reservation.taxRate || "0"), 2, formatLocale),
                    })}
                  </span>
                  <span>
                    {formatCurrency(parseFloat(reservation.taxAmount), currency, formatLocale)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t("subtotalInclTax")}</span>
                  <span className="font-medium">
                    {formatCurrency(parseFloat(reservation.subtotalAmount), currency, formatLocale)}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("subtotalRental")}</span>
                <span className="font-medium">
                  {formatCurrency(parseFloat(reservation.subtotalAmount), currency, formatLocale)}
                </span>
              </div>
            )}

            {reservation.discountAmount && parseFloat(reservation.discountAmount) > 0 && (
              <div className="flex justify-between text-green-600">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" />
                  {t("promoDiscount")}
                  {reservation.promoCodeSnapshot && (
                    <Badge variant="success" className="ml-1 text-xs">
                      {reservation.promoCodeSnapshot.code}
                    </Badge>
                  )}
                </span>
                <span>
                  -{formatCurrency(parseFloat(reservation.discountAmount), currency, formatLocale)}
                </span>
              </div>
            )}

            {reservation.deliveryFee && parseFloat(reservation.deliveryFee) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Truck className="h-3.5 w-3.5" />
                  {t("deliveryFeeLabel")}
                </span>
                <span>
                  {formatCurrency(parseFloat(reservation.deliveryFee), currency, formatLocale)}
                </span>
              </div>
            )}

            <div className="flex justify-between border-t pt-2 font-semibold">
              <span>{t("totalAmount")}</span>
              <span>{formatCurrency(rental, currency, formatLocale)}</span>
            </div>

            {parseFloat(reservation.depositAmount) > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>{t("totalDeposit")}</span>
                <span>
                  {formatCurrency(parseFloat(reservation.depositAmount), currency, formatLocale)}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
