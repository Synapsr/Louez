"use client";

import Link from "next/link";

import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CreditCard,
  History,
  Pencil,
  Plus,
  Receipt,
} from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldValues } from "@louez/types";
import { Badge, Button } from "@louez/ui";
import { formatCurrency } from "@louez/utils";
import { type CustomerFormLayoutItem, resolveStoreCustomerFormLayout } from "@louez/validations";

import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";
import { UserAvatar } from "@/components/dashboard/shared/user-avatar";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { formatStoreDate } from "@/lib/utils/store-date";

import type {
  CustomerDetail,
  CustomerHistoryReservation,
  CustomerStats,
} from "./customer-detail.types";
import { CustomerNotes } from "./customer-notes";
import { CustomerRecordSide } from "./customer-record-side";
import { CustomerReservationsCard } from "./customer-reservations-card";
import { getLastReservationDate } from "./util.customer-stats";

interface CustomerDetailViewProps {
  customer: CustomerDetail;
  reservations: CustomerHistoryReservation[];
  stats: CustomerStats;
  /** Store data the record reads; the landing demos keep the defaults. */
  currency?: string;
  timezone?: string | null;
  storeCountry?: string;
  /** The customer form's layout, hidden items left out, both customer types. */
  items?: CustomerFormLayoutItem[];
  customFields?: CustomerFieldValues;
  readOnly?: boolean;
  onBack?: () => void;
  onOpenReservation?: (reservation: CustomerHistoryReservation) => void;
  getReservationHref?: (reservation: CustomerHistoryReservation) => string;
}

/** A record shown without store settings (landing demos): the default layout, no custom field. */
const DEFAULT_ITEMS = resolveStoreCustomerFormLayout({
  settings: null,
  scope: "customer",
  definitions: [],
});

export const CustomerDetailView = ({
  customer,
  reservations,
  stats,
  currency = "EUR",
  timezone = null,
  storeCountry = "FR",
  items = DEFAULT_ITEMS,
  customFields = {},
  readOnly = false,
  onBack,
  onOpenReservation,
  getReservationHref,
}: CustomerDetailViewProps) => {
  const t = useTranslations("dashboard.customers");
  const { intl: formatLocale, dateFns: dateLocale } = useFormatLocale();

  const isBusiness = customer.customerType === "business" && Boolean(customer.companyName);
  const fullName = `${customer.firstName} ${customer.lastName}`.trim();
  const displayName = isBusiness ? (customer.companyName ?? fullName) : fullName;
  const lastReservationAt = getLastReservationDate(reservations);

  return (
    <div className="space-y-4 sm:space-y-6">
      <DashboardBreadcrumbLabel label={displayName} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0"
            disabled={readOnly && !onBack}
            render={readOnly ? undefined : <Link href="/dashboard/customers" />}
            onClick={onBack}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <UserAvatar seed={customer.email} size={44} />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">
                {displayName}
              </h1>
              <Badge variant="expired" className="font-normal">
                {isBusiness && <Building2 className="size-3" />}
                {t(`customerType.${customer.customerType}`)}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {isBusiness && `${t("contact")} : ${fullName} · `}
              {t("customerSince")}{" "}
              {formatStoreDate(customer.createdAt, timezone, "MEDIUM_DATE", formatLocale)}
              {customer.createdVia &&
                ` · ${t("detail.createdVia", { channel: t(`channels.${customer.createdVia}`) })}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            disabled={readOnly}
            render={readOnly ? undefined : <Link href={`/dashboard/customers/${customer.id}/edit`} />}
          >
            <Pencil className="size-4" />
            {t("detail.edit")}
          </Button>
          <Button
            disabled={readOnly}
            render={
              readOnly ? undefined : (
                <Link href={`/dashboard/reservations/new?customerId=${customer.id}`} />
              )
            }
          >
            <Plus className="size-4" />
            {t("detail.newReservation")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <DashboardStatCard
          title={t("totalReservations")}
          value={stats.totalReservations}
          subtitle={t("completedCount", { count: stats.completedReservations })}
          icon={CalendarDays}
          accent="primary"
        />
        <DashboardStatCard
          title={t("totalSpent")}
          value={formatCurrency(stats.totalSpent, currency, formatLocale)}
          icon={CreditCard}
          accent="success"
        />
        <DashboardStatCard
          title={t("averageOrder")}
          value={formatCurrency(stats.avgOrderValue, currency, formatLocale)}
          icon={Receipt}
          accent="neutral"
        />
        <DashboardStatCard
          title={t("detail.lastRental")}
          value={
            lastReservationAt
              ? formatDistanceToNow(lastReservationAt, { addSuffix: true, locale: dateLocale })
              : t("detail.never")
          }
          icon={History}
          accent="progress"
        />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-6 lg:col-span-2">
          <CustomerReservationsCard
            reservations={reservations}
            customer={customer}
            currency={currency}
            timezone={timezone}
            formatLocale={formatLocale}
            readOnly={readOnly}
            onOpenReservation={onOpenReservation}
            getReservationHref={getReservationHref}
          />
          <DashboardSectionCard title={t("notes.title")}>
            <CustomerNotes
              customerId={customer.id}
              initialNotes={customer.notes || ""}
              readOnly={readOnly}
            />
          </DashboardSectionCard>
        </div>

        <CustomerRecordSide
          customer={{
            id: customer.id,
            customerType: customer.customerType,
            email: customer.email,
            firstName: customer.firstName,
            lastName: customer.lastName,
            companyName: customer.companyName,
            companyNumber: customer.companyNumber,
            vatNumber: customer.vatNumber,
            phone: customer.phone,
            address: customer.address,
            city: customer.city,
            postalCode: customer.postalCode,
            country: customer.country,
            birthDate: customer.birthDate ?? null,
            acquisitionSource: customer.acquisitionSource ?? null,
            acquisitionSourceDetail: customer.acquisitionSourceDetail ?? null,
            socialLinks: customer.socialLinks ?? null,
            notes: customer.notes,
            createdVia: customer.createdVia ?? null,
          }}
          items={items}
          customFields={customFields}
          storeCountry={storeCountry}
          locale={formatLocale}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
};
