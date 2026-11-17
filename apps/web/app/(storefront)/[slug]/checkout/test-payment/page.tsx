import { InfoIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";

import type { Metadata } from "next";

import { and, eq } from "drizzle-orm";

import { db, reservations } from "@louez/db";
import { Button } from "@louez/ui";

import { OutcomeHeader } from "@/components/storefront/ui/outcome-header";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { formatCurrency } from "@/lib/utils";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";
import { simulatedPaymentAmount } from "@/lib/test-reservations/simulate-payment";
import { getStorefrontTestMode } from "@/lib/test-reservations/storefront-test-mode";

import { SimulatePaymentButton } from "./simulate-payment-button";

interface TestPaymentPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reservation?: string }>;
}

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The payment page of a test reservation in a store that takes payment online
 * (lib/test-reservations): the amount the checkout would charge, the deposit, and
 * one button that simulates the payment. No card, no Stripe, nothing charged.
 */
const TestPaymentPage = async ({ params, searchParams }: TestPaymentPageProps) => {
  const [{ slug }, { reservation: reservationId }] = await Promise.all([params, searchParams]);
  const store = await getStoreBySlug(slug);
  if (!store) notFound();

  const [t, tErrors, testMode] = await Promise.all([
    getTranslations("storefront.testMode.payment"),
    getTranslations("errors"),
    getStorefrontTestMode(store.id),
  ]);

  if (!testMode) {
    return (
      <StorefrontSection width="narrow">
        <OutcomeHeader tone="info" icon={<InfoIcon />} title={tErrors("testModeRequired")}>
          <Button
            variant="outline"
            size="xl"
            className="h-12 w-full lg:h-10 sm:w-auto"
            render={<StorefrontLink href="/" />}
          >
            {store.name}
          </Button>
        </OutcomeHeader>
      </StorefrontSection>
    );
  }

  const reservation = reservationId
    ? await db.query.reservations.findFirst({
        where: and(
          eq(reservations.id, reservationId),
          eq(reservations.storeId, store.id),
          eq(reservations.isTest, true),
        ),
        columns: {
          id: true,
          number: true,
          status: true,
          totalAmount: true,
          depositAmount: true,
          currency: true,
        },
      })
    : undefined;
  if (!reservation) notFound();

  if (reservation.status !== "pending") {
    return (
      <StorefrontSection width="narrow">
        <OutcomeHeader tone="info" icon={<InfoIcon />} title={t("notPending")}>
          <SimulatePaymentButton
            slug={store.slug}
            reservationId={reservation.id}
            label={t("viewReservation")}
          />
        </OutcomeHeader>
      </StorefrontSection>
    );
  }

  const { amount, currency } = simulatedPaymentAmount({
    totalAmount: reservation.totalAmount,
    currency: reservation.currency,
    depositPercentage: store.settings?.onlinePaymentDepositPercentage,
    storeCurrency: store.settings?.currency,
  });
  const deposit = Number.parseFloat(reservation.depositAmount);
  const formatLocale = await getRequestFormatLocale();
  const formatMoney = (value: number) => formatCurrency(value, currency, formatLocale.intl);

  return (
    <StorefrontSection width="narrow">
      <SectionHeader
        level="h1"
        align="center"
        title={t("title")}
        description={t("reservation", { number: reservation.number })}
      />
      <div className="flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-card sm:p-6">
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-muted p-4 text-center">
          <span className="text-xs text-muted-foreground">{t("amountDue")}</span>
          <span className="text-3xl font-semibold tabular-nums">{formatMoney(amount)}</span>
        </div>
        {deposit > 0 ? (
          <p className="flex justify-between gap-3 text-sm">
            <span>
              {t("deposit")} <span className="text-muted-foreground">· {t("depositNote")}</span>
            </span>
            <span className="tabular-nums">{formatMoney(deposit)}</span>
          </p>
        ) : null}
        <p className="text-pretty text-sm text-muted-foreground">{t("description")}</p>
        <SimulatePaymentButton
          slug={store.slug}
          reservationId={reservation.id}
          label={t("submit")}
        />
      </div>
    </StorefrontSection>
  );
};

export default TestPaymentPage;
