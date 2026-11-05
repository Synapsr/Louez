"use client";

import Link from "next/link";

import { Building2, CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@louez/ui";
import { formatCurrency, isBusinessBilling, resolveReservationBilling } from "@louez/utils";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { formatStoreDateRange } from "@/lib/utils/store-date";

import type { CustomerDetail, CustomerHistoryReservation } from "./customer-detail.types";

interface CustomerReservationsCardProps {
  reservations: CustomerHistoryReservation[];
  customer: CustomerDetail;
  currency: string;
  timezone: string | null | undefined;
  formatLocale: string;
  readOnly?: boolean;
  onOpenReservation?: (reservation: CustomerHistoryReservation) => void;
  getReservationHref?: (reservation: CustomerHistoryReservation) => string;
}

const STATUS_VARIANTS: Record<string, "pending" | "progress" | "success" | "failed"> = {
  pending: "pending",
  confirmed: "success",
  ongoing: "progress",
  completed: "success",
  cancelled: "failed",
  rejected: "failed",
};

export const CustomerReservationsCard = ({
  reservations,
  customer,
  currency,
  timezone,
  formatLocale,
  readOnly = false,
  onOpenReservation,
  getReservationHref,
}: CustomerReservationsCardProps) => {
  const t = useTranslations("dashboard.customers");
  const tReservations = useTranslations("dashboard.reservations");
  const tCommon = useTranslations("common");

  return (
    <DashboardSectionCard title={t("reservationHistory")} contentClassName="p-0 sm:p-0">
      {reservations.length === 0 ? (
        <DashboardEmptyState icon={CalendarDays} description={t("noReservationsForCustomer")} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tReservations("number")}</TableHead>
              <TableHead>{tReservations("period")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("products")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("billedAs")}</TableHead>
              <TableHead>{tCommon("status")}</TableHead>
              <TableHead className="text-right">{t("amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reservations.map((reservation) => {
              const billing = resolveReservationBilling(reservation, customer);
              return (
                <TableRow key={reservation.id}>
                  <TableCell>
                    <Link
                      href={
                        getReservationHref?.(reservation) ??
                        (readOnly ? "#" : `/dashboard/reservations/${reservation.id}`)
                      }
                      prefetch={readOnly || onOpenReservation ? false : undefined}
                      data-customer-reservation={reservation.id}
                      data-customer-reservation-status={reservation.status}
                      onClick={(event) => {
                        if (readOnly || onOpenReservation) {
                          event.preventDefault();
                          onOpenReservation?.(reservation);
                        }
                      }}
                      className="font-medium hover:underline"
                    >
                      #{reservation.number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    {formatStoreDateRange(
                      reservation.startDate,
                      reservation.endDate,
                      timezone,
                      formatLocale,
                    )}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {reservation.items
                      .map(
                        (item) =>
                          `${item.product?.name ?? t("deletedProduct")}${item.quantity > 1 ? ` (x${item.quantity})` : ""}`,
                      )
                      .join(", ")}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {isBusinessBilling(billing) ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <Building2 className="text-muted-foreground size-3.5" />
                        {billing.companyName}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">
                        {t("customerType.individual")}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[reservation.status] ?? "pending"}>
                      {tReservations(`status.${reservation.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(parseFloat(reservation.totalAmount), currency, formatLocale)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </DashboardSectionCard>
  );
};
