import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { and, desc, eq } from "drizzle-orm";
import { PackageIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { db, reservations } from "@louez/db";
import { Button } from "@louez/ui";

import { PageTracker } from "@/components/storefront/page-tracker";
import type { ReservationListItem } from "@/components/storefront/account/reservation-list-card";
import { ReservationListSection } from "@/components/storefront/account/reservation-list-section";
import {
  isCurrentReservationStatus,
  toReservationStatus,
} from "@/components/storefront/account/reservation-status.constants";
import { EmptyState } from "@/components/storefront/ui/empty-state";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontPageRefresh } from "@/components/storefront/ui/storefront-page-refresh";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { requireCustomerSession } from "@/lib/customer-auth/require-customer-session";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { isRentalPaid } from "@/lib/reservations/util.payment-status";
import { getReservationActions } from "@/lib/reservations/util.reservation-actions";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { formatStoreDateRange } from "@/lib/utils/store-date";

interface AccountPageProps {
  params: Promise<{ slug: string }>;
}

// Private page data is cached only in this browser for thirty seconds.
export const unstable_dynamicStaleTime = 30;

export async function generateMetadata({ params }: AccountPageProps): Promise<Metadata> {
  const { slug } = await params;
  const store = await getStoreBySlug(slug);
  if (!store) return { title: "Boutique introuvable" };

  const t = await getTranslations("storefront.account");

  return generateStoreMetadata(store, {
    title: `${t("title")} - ${store.name}`,
    description: t("myReservations"),
    noIndex: true,
  });
}

/**
 * The customer's reservations in two stacks, current and past, each card
 * carrying the one thing left to do. No counters: the list is the summary.
 */
export default async function AccountPage({ params }: AccountPageProps) {
  const { slug } = await params;
  const store = await getStoreBySlug(slug);
  if (!store) notFound();

  const [session, t, { intl: formatLocale }] = await Promise.all([
    requireCustomerSession(store, "/account"),
    getTranslations("storefront.account"),
    getRequestFormatLocale(),
  ]);

  const rows = await db.query.reservations.findMany({
    where: and(eq(reservations.storeId, store.id), eq(reservations.customerId, session.customerId)),
    orderBy: [desc(reservations.createdAt)],
    columns: {
      id: true,
      number: true,
      status: true,
      startDate: true,
      endDate: true,
      totalAmount: true,
      signedAt: true,
    },
    with: {
      items: { columns: { id: true, productSnapshot: true, quantity: true } },
      payments: { columns: { type: true, status: true, amount: true } },
    },
  });

  const timezone = store.settings?.timezone;
  const items: ReservationListItem[] = rows.map((row) => ({
    id: row.id,
    number: row.number,
    status: toReservationStatus(row.status),
    periodLabel: formatStoreDateRange(row.startDate, row.endDate, timezone, formatLocale),
    itemCount: row.items.reduce((sum, item) => sum + item.quantity, 0),
    products: row.items.map((item) => ({
      name: item.productSnapshot.name,
      imageUrl: item.productSnapshot.images?.[0] ?? null,
    })),
    totalAmount: Number.parseFloat(row.totalAmount),
    requiredAction: getReservationActions({
      status: row.status,
      isRentalPaid: isRentalPaid(row.payments),
      isSigned: row.signedAt !== null,
      stripeAccountId: store.stripeAccountId,
      stripeChargesEnabled: store.stripeChargesEnabled,
    }).required,
  }));

  const ongoing = items.filter((item) => item.status === "ongoing");
  const current = items.filter(
    (item) => isCurrentReservationStatus(item.status) && item.status !== "ongoing",
  );
  const past = items.filter((item) => !isCurrentReservationStatus(item.status));

  return (
    <>
      <StorefrontPageRefresh renderedAt={Date.now()} />
      <PageTracker page="account" />
      <StorefrontSection contentClassName="flex max-w-5xl flex-col gap-6 sm:gap-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {t("myReservations")}
            </h1>
          </div>
        </header>

        {items.length === 0 ? (
          <EmptyState
            icon={<PackageIcon />}
            title={t("noReservations")}
            description={t("noReservationsDescription")}
            tone="card"
            action={
              <Button size="lg" render={<StorefrontLink href="/catalog" />}>
                {t("viewCatalog")}
              </Button>
            }
          />
        ) : (
          <>
            <ReservationListSection title={t("status.ongoing")} reservations={ongoing} />
            <ReservationListSection title={t("currentReservations")} reservations={current} />
            <ReservationListSection title={t("pastReservations")} reservations={past} />
          </>
        )}
      </StorefrontSection>
    </>
  );
}
