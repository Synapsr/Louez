import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { formatDistanceToNow } from "date-fns";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, Building2, CalendarDays, CreditCard, History, Pencil, Plus, Receipt } from "lucide-react";
import { getTranslations } from "next-intl/server";

import {
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
} from "@louez/api/services/customer-fields";
import { customers, db, reservations } from "@louez/db";
import { Badge, Button } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { DashboardBreadcrumbLabel } from "@/components/dashboard/dashboard-breadcrumbs-context";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { DashboardStatCard } from "@/components/dashboard/shared/dashboard-stat-card";
import { UserAvatar } from "@/components/dashboard/shared/user-avatar";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { getCurrentStore } from "@/lib/store-context";
import { formatStoreDate } from "@/lib/utils/store-date";

import { CustomerNotes } from "./customer-notes";
import { CustomerRecordSide } from "./customer-record-side";
import { CustomerReservationsCard } from "./customer-reservations-card";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

interface CustomerPageProps {
  params: Promise<{ id: string }>;
}

export default async function CustomerPage({ params }: CustomerPageProps) {
  const t = await getTranslations("dashboard.customers");
  const { intl: formatLocale, dateFns: dateLocale } = await getRequestFormatLocale();
  const store = await getCurrentStore();

  if (!store) {
    redirect("/onboarding");
  }

  const { id } = await params;

  const customer = await db.query.customers.findFirst({
    where: and(eq(customers.id, id), eq(customers.storeId, store.id)),
  });

  if (!customer) {
    notFound();
  }

  const [customerReservations, definitions, customFields] = await Promise.all([
    db.query.reservations.findMany({
      where: and(eq(reservations.customerId, customer.id), eq(reservations.storeId, store.id)),
      with: { items: { with: { product: { columns: { name: true } } } } },
      orderBy: [desc(reservations.createdAt)],
    }),
    listCustomerFieldDefinitions(store.id, { activeOnly: true }),
    getCustomerFieldValues(store.id, customer.id),
  ]);

  const currency = store.settings?.currency || "EUR";
  const timezone = store.settings?.timezone;
  const counted = customerReservations.filter(
    (reservation) => reservation.status === "completed" || reservation.status === "ongoing",
  );
  const totalSpent = counted.reduce((sum, reservation) => sum + parseFloat(reservation.totalAmount), 0);
  const completedCount = customerReservations.filter(
    (reservation) => reservation.status === "completed",
  ).length;
  const averageOrder =
    customerReservations.length > 0
      ? customerReservations.reduce((sum, r) => sum + parseFloat(r.totalAmount), 0) /
        customerReservations.length
      : 0;
  const lastReservation = customerReservations[0];

  const isBusiness = customer.customerType === "business" && Boolean(customer.companyName);
  const fullName = `${customer.firstName} ${customer.lastName}`.trim();
  const displayName = isBusiness ? (customer.companyName ?? fullName) : fullName;

  return (
    <div className="space-y-4 sm:space-y-6">
      <DashboardBreadcrumbLabel label={displayName} />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            render={<Link href="/dashboard/customers" />}
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <UserAvatar seed={customer.email ?? customer.id} size={44} />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold tracking-tight sm:text-2xl">{displayName}</h1>
              <Badge variant="expired" className="font-normal">
                {isBusiness && <Building2 className="size-3" />}
                {t(`customerType.${customer.customerType}`)}
              </Badge>
            </div>
            <p className="text-muted-foreground text-sm">
              {isBusiness && `${t("contact")} : ${fullName} · `}
              {t("customerSince")} {formatStoreDate(customer.createdAt, timezone, "MEDIUM_DATE", formatLocale)}
              {customer.createdVia &&
                ` · ${t("detail.createdVia", { channel: t(`channels.${customer.createdVia}`) })}`}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            render={<Link href={`/dashboard/customers/${customer.id}/edit`} />}
            variant="outline"
          >
            <Pencil className="size-4" />
            {t("detail.edit")}
          </Button>
          <Button render={<Link href={`/dashboard/reservations/new?customerId=${customer.id}`} />}>
            <Plus className="size-4" />
            {t("detail.newReservation")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <DashboardStatCard
          title={t("totalReservations")}
          value={customerReservations.length}
          subtitle={t("completedCount", { count: completedCount })}
          icon={CalendarDays}
          accent="primary"
        />
        <DashboardStatCard
          title={t("totalSpent")}
          value={formatCurrency(totalSpent, currency, formatLocale)}
          icon={CreditCard}
          accent="success"
        />
        <DashboardStatCard
          title={t("averageOrder")}
          value={formatCurrency(averageOrder, currency, formatLocale)}
          icon={Receipt}
          accent="neutral"
        />
        <DashboardStatCard
          title={t("detail.lastRental")}
          value={
            lastReservation
              ? formatDistanceToNow(lastReservation.createdAt, { addSuffix: true, locale: dateLocale })
              : t("detail.never")
          }
          icon={History}
          accent="progress"
        />
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-6 lg:col-span-2">
          <CustomerReservationsCard
            reservations={customerReservations}
            customer={customer}
            currency={currency}
            timezone={timezone}
            formatLocale={formatLocale}
          />
          <DashboardSectionCard title={t("notes.title")}>
            <CustomerNotes customerId={customer.id} initialNotes={customer.notes || ""} />
          </DashboardSectionCard>
        </div>

        <CustomerRecordSide
          customer={{
            id: customer.id,
            customerType: customer.customerType,
            email: customer.email,
            phone: customer.phone,
            address: customer.address,
            city: customer.city,
            postalCode: customer.postalCode,
            country: customer.country,
            birthDate: customer.birthDate,
            acquisitionSource: customer.acquisitionSource,
            acquisitionSourceDetail: customer.acquisitionSourceDetail,
            createdVia: customer.createdVia,
            socialLinks: customer.socialLinks,
          }}
          definitions={definitions}
          customFields={customFields}
          profileSettings={store.settings?.customerProfile ?? {}}
          storeCountry={store.settings?.country ?? "FR"}
          locale={formatLocale}
        />
      </div>
    </div>
  );
}
