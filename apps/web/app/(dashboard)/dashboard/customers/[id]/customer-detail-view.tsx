"use client";

import Link from "next/link";
import { format } from "date-fns";

import { useTranslations } from "next-intl";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Calendar,
  Pencil,
  CreditCard,
  Building2,
} from "lucide-react";

import { Button } from "@louez/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@louez/ui";
import { Badge } from "@louez/ui";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@louez/ui";
import { formatCurrency, isBusinessBilling, resolveReservationBilling } from "@louez/utils";
import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { EmailContactPopover } from "@/components/dashboard/email-contact-popover";
import { PhoneContactPopover } from "@/components/dashboard/phone-contact-popover";
import { CustomerNotes } from "./customer-notes";
import { useFormatLocale } from "@/hooks/use-format-locale";
import type {
  CustomerDetail,
  CustomerHistoryReservation,
  CustomerStats,
} from "./customer-detail.types";

const statusVariants: Record<string, "pending" | "progress" | "success" | "failed"> = {
  pending: "pending",
  confirmed: "success",
  ongoing: "progress",
  completed: "success",
  cancelled: "failed",
  rejected: "failed",
};

interface CustomerDetailViewProps {
  customer: CustomerDetail;
  reservations: CustomerHistoryReservation[];
  stats: CustomerStats;
  readOnly?: boolean;
  onBack?: () => void;
  onOpenReservation?: (reservation: CustomerHistoryReservation) => void;
  getReservationHref?: (reservation: CustomerHistoryReservation) => string;
}

export const CustomerDetailView = ({
  customer,
  reservations,
  stats,
  readOnly = false,
  onBack,
  onOpenReservation,
  getReservationHref,
}: CustomerDetailViewProps) => {
  const t = useTranslations("dashboard.customers");
  const tReservations = useTranslations("dashboard.reservations");
  const tCommon = useTranslations("common");
  const { intl: formatLocale, dateFns: dateLocale } = useFormatLocale();
  const customerBreadcrumbLabel =
    customer.customerType === "business" && customer.companyName
      ? customer.companyName
      : `${customer.firstName} ${customer.lastName}`.trim();

  return (
    <div className="space-y-6">
      <DashboardBreadcrumbLabel label={customerBreadcrumbLabel} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            disabled={readOnly && !onBack}
            render={readOnly ? undefined : <Link href="/dashboard/customers" />}
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="space-y-1">
            {customer.customerType === "business" && customer.companyName ? (
              <>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    {customer.companyName}
                  </h1>
                  <Badge variant="expired" className="font-normal">
                    {t("customerType.business")}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("contact")}: {customer.firstName} {customer.lastName} · {t("customerSince")}{" "}
                  {format(customer.createdAt, "dd MMMM yyyy", { locale: dateLocale })}
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight">
                    {customer.firstName} {customer.lastName}
                  </h1>
                  <Badge variant="expired" className="font-normal">
                    {t("customerType.individual")}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {t("customerSince")}{" "}
                  {format(customer.createdAt, "dd MMMM yyyy", { locale: dateLocale })}
                </p>
              </>
            )}
          </div>
        </div>
        <Button
          disabled={readOnly}
          render={readOnly ? undefined : <Link href={`/dashboard/customers/${customer.id}/edit`} />}
        >
          <Pencil className="mr-2 h-4 w-4" />
          {tCommon("edit")}
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("totalReservations")}</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalReservations}</div>
            <p className="text-xs text-muted-foreground">
              {t("completedCount", { count: stats.completedReservations })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("totalSpent")}</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.totalSpent, "EUR", formatLocale)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("averageOrder")}</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(stats.avgOrderValue, "EUR", formatLocale)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("completionRate")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.totalReservations > 0
                ? Math.round((stats.completedReservations / stats.totalReservations) * 100)
                : 0}
              %
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t("contact")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <EmailContactPopover
                disabled={readOnly}
                email={customer.email}
                className="text-foreground"
              />
            </div>
            {customer.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-4 w-4 text-muted-foreground" />
                <PhoneContactPopover
                  disabled={readOnly}
                  phone={customer.phone}
                  className="text-foreground"
                />
              </div>
            )}
            {(customer.address || customer.city || customer.postalCode) && (
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  {customer.address && <div>{customer.address}</div>}
                  {(customer.postalCode || customer.city) && (
                    <div>
                      {customer.postalCode} {customer.city}
                    </div>
                  )}
                  {customer.country && customer.country !== "FR" && (
                    <div className="text-muted-foreground">{customer.country}</div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("notes.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerNotes
              readOnly={readOnly}
              customerId={customer.id}
              initialNotes={customer.notes || ""}
            />
          </CardContent>
        </Card>
      </div>

      {/* Reservations */}
      <Card>
        <CardHeader>
          <CardTitle data-demo-target="customer-history">{t("reservationHistory")}</CardTitle>
        </CardHeader>
        <CardContent>
          {reservations.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {t("noReservationsForCustomer")}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tReservations("number")}</TableHead>
                  <TableHead>{tReservations("period")}</TableHead>
                  <TableHead>{t("products")}</TableHead>
                  <TableHead>{t("billedAs")}</TableHead>
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
                      <TableCell>
                        <div className="text-sm">
                          {format(reservation.startDate, "dd/MM/yyyy", { locale: dateLocale })}
                          {" - "}
                          {format(reservation.endDate, "dd/MM/yyyy", { locale: dateLocale })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {reservation.items.map((item, idx) => (
                            <span key={item.id}>
                              {idx > 0 && ", "}
                              {item.product?.name || t("deletedProduct")}
                              {item.quantity > 1 && ` (x${item.quantity})`}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {isBusinessBilling(billing) ? (
                          <span className="flex items-center gap-1.5 text-sm">
                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                            {billing.companyName}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">
                            {t("customerType.individual")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariants[reservation.status]}>
                          {tReservations(`status.${reservation.status}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(parseFloat(reservation.totalAmount), "EUR", formatLocale)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
