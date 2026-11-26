import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckIcon, ClockIcon, ShoppingCartIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { and, eq } from "drizzle-orm";

import { db, reservations } from "@louez/db";
import { Button } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { EmptyState } from "@/components/storefront/ui/empty-state";
import { OutcomeHeader } from "@/components/storefront/ui/outcome-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { getRequestFormatLocale } from "@/lib/i18n/format-locale.server";
import { reservationCurrency } from "@/lib/reservations/payment-billing-facts";
import { getRentalBalance } from "@/lib/reservations/util.rental-amount";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

import { ResumePaymentButton } from "./resume-payment-button";

interface CheckoutCancelledPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reservation?: string }>;
}

export const instant = false;

export const generateMetadata = async ({
  params,
}: CheckoutCancelledPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.checkout.cancelled"),
  ]);

  if (!store) {
    return { title: t("title") };
  }

  return generateStoreMetadata(store, { title: `${t("title")} - ${store.name}`, noIndex: true });
};

/**
 * Stripe `cancel_url` of the storefront checkout. The cart is untouched (it
 * only empties on the verified return), the reservation stays pending: the
 * customer resumes the payment or goes back to the cart. Once the payment
 * window has closed the reservation is cancelled server-side, so the page
 * only offers the cart, which rebooks the same thing in a few clicks. A
 * booking confirmed meanwhile reads its balance (`getRentalBalance`): paid, or
 * what remains, which its page takes.
 */
const CheckoutCancelledPage = async ({ params, searchParams }: CheckoutCancelledPageProps) => {
  const [{ slug }, { reservation: reservationId }, t, { intl: formatLocale }] = await Promise.all([
    params,
    searchParams,
    getTranslations("storefront.checkout.cancelled"),
    getRequestFormatLocale(),
  ]);

  const store = await getStoreBySlug(slug);
  if (!store) {
    notFound();
  }

  const reservation = reservationId
    ? await db.query.reservations.findFirst({
        columns: { id: true, number: true, status: true, totalAmount: true, currency: true },
        where: and(eq(reservations.id, reservationId), eq(reservations.storeId, store.id)),
        // What settles the rental (`getRentalBalance`): a confirmed booking may still owe its balance.
        with: { payments: true },
      })
    : null;
  const currency = reservation ? reservationCurrency(reservation.currency, store.settings) : null;
  const rentalDue = reservation && currency ? getRentalBalance(reservation, currency).due : 0;

  const backToCart = (
    <Button
      variant="outline"
      size="xl"
      className="h-12 w-full lg:h-10 sm:w-auto"
      render={<StorefrontLink href="/checkout" />}
    >
      {t("backToCart")}
    </Button>
  );

  return (
    <StorefrontSection width="narrow">
      {!reservation ? (
        <EmptyState
          icon={<ShoppingCartIcon />}
          title={t("title")}
          description={t("cartKept")}
          action={backToCart}
        />
      ) : reservation.status === "confirmed" ? (
        <OutcomeHeader
          tone="success"
          icon={<CheckIcon />}
          title={rentalDue > 0 ? t("balanceDueTitle") : t("alreadyPaidTitle")}
          description={
            rentalDue > 0 && currency
              ? t("balanceDueDescription", {
                  number: reservation.number,
                  amount: formatCurrency(rentalDue, currency, formatLocale),
                })
              : t("alreadyPaidDescription", { number: reservation.number })
          }
        >
          <Button
            size="xl"
            className="h-12 w-full lg:h-10 sm:w-auto"
            render={<StorefrontLink href={`/account/reservations/${reservation.id}`} />}
          >
            {t("viewReservation")}
          </Button>
        </OutcomeHeader>
      ) : reservation.status === "pending" ? (
        <OutcomeHeader
          tone="pending"
          icon={<ClockIcon />}
          title={t("title")}
          description={t("description", { number: reservation.number })}
        >
          <ResumePaymentButton slug={store.slug} reservationId={reservation.id} />
          {backToCart}
        </OutcomeHeader>
      ) : reservation.status === "cancelled" ? (
        <EmptyState
          icon={<ClockIcon />}
          title={t("expiredTitle")}
          description={t("expiredDescription", { number: reservation.number })}
          action={backToCart}
        />
      ) : (
        <EmptyState
          icon={<ShoppingCartIcon />}
          title={t("title")}
          description={t("cartKept")}
          action={backToCart}
        />
      )}
    </StorefrontSection>
  );
};

export default CheckoutCancelledPage;
