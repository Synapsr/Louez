import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckIcon, ClockIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { Button } from "@louez/ui";

import { ReservationCartReset } from "@/components/storefront/account/reservation-cart-reset";
import { OutcomeHeader } from "@/components/storefront/ui/outcome-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontPageRefresh } from "@/components/storefront/ui/storefront-page-refresh";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { buildLoginPath } from "@/lib/customer-auth/util.account-redirect";
import { readCheckoutPaidClaim } from "@/lib/reservations/checkout-paid-cookie";
import { getCheckoutPaidView } from "@/lib/reservations/checkout-paid-view";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

interface CheckoutPaidPageProps {
  params: Promise<{ slug: string }>;
}

export const instant = false;

export const generateMetadata = async ({ params }: CheckoutPaidPageProps): Promise<Metadata> => {
  const { slug } = await params;
  const [store, t] = await Promise.all([
    getStoreBySlug(slug),
    getTranslations("storefront.checkout.paid"),
  ]);

  if (!store) {
    return { title: t("metaTitle") };
  }

  return generateStoreMetadata(store, {
    title: `${t("metaTitle")} - ${store.name}`,
    noIndex: true,
  });
};

/**
 * Where Stripe's return lands a customer who is not signed in as the
 * reservation's customer. It opens no session and shows nothing of the
 * customer: the outcome, the reservation's number, the store's name, and one
 * way in, the sign-in by e-mail code for this reservation. Its URL carries
 * nothing: the reservation and the Stripe session come from the cookie only
 * the return sets, and are checked again against the reservation's payments.
 * Without that cookie, or for a pair that is not one of its payments, it is
 * the storefront's not-found.
 */
const CheckoutPaidPage = async ({ params }: CheckoutPaidPageProps) => {
  const { slug } = await params;
  const store = await getStoreBySlug(slug);
  const claim = store ? await readCheckoutPaidClaim(store.id) : null;
  const view =
    store && claim
      ? await getCheckoutPaidView({
          storeId: store.id,
          reservationId: claim.reservationId,
          stripeCheckoutSessionId: claim.stripeCheckoutSessionId,
        })
      : null;

  if (!store || !claim || !view) {
    notFound();
  }

  const [t, tOutcome, tCheckout] = await Promise.all([
    getTranslations("storefront.checkout.paid"),
    getTranslations("storefront.account.outcome"),
    getTranslations("storefront.checkout.cancelled"),
  ]);
  const received = view.state === "received";
  const values = { number: view.number, store: store.name };
  const loginHref = buildLoginPath({
    redirect: `/account/reservations/${claim.reservationId}?event=paid`,
    ownerOnly: true,
  });

  return (
    <StorefrontSection width="narrow">
      <ReservationCartReset reservationId={claim.reservationId} settled={received} />
      {received ? null : <StorefrontPageRefresh renderedAt={Date.now()} />}
      <OutcomeHeader
        tone={received ? "success" : "pending"}
        icon={received ? <CheckIcon /> : <ClockIcon />}
        title={received ? tOutcome("payment_received.title") : t("unverifiedTitle")}
        description={
          received
            ? t(view.confirmationEmailSent ? "receivedEmailed" : "received", values)
            : t("unverified", values)
        }
      >
        <Button
          size="xl"
          className="h-12 w-full lg:h-10 sm:w-auto"
          render={<StorefrontLink href={loginHref} />}
        >
          {tCheckout("viewReservation")}
        </Button>
      </OutcomeHeader>
    </StorefrontSection>
  );
};

export default CheckoutPaidPage;
