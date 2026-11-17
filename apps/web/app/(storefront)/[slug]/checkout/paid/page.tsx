import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CheckIcon, ClockIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

import { z } from "zod";

import { Button } from "@louez/ui";

import { ReservationCartReset } from "@/components/storefront/account/reservation-cart-reset";
import { OutcomeHeader } from "@/components/storefront/ui/outcome-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { StorefrontPageRefresh } from "@/components/storefront/ui/storefront-page-refresh";
import { StorefrontSection } from "@/components/storefront/ui/storefront-section";
import { buildLoginPath } from "@/lib/customer-auth/util.account-redirect";
import { getCheckoutPaidView } from "@/lib/reservations/checkout-paid-view";
import { generateStoreMetadata } from "@/lib/seo";
import { getStoreBySlug } from "@/lib/storefront/get-store-by-slug";

interface CheckoutPaidPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ reservation?: string | string[]; session_id?: string | string[] }>;
}

const paidQuerySchema = z.object({
  reservation: z.string().trim().min(1).max(64),
  session_id: z.string().trim().min(1).max(255),
});

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
 * reservation's customer. Its URL may be held by anyone, so it opens no
 * session and shows nothing of the customer: the outcome, the reservation's
 * number, the store's name, and one way in, the sign-in by e-mail code. It
 * shows anything only for the reservation id with the Stripe session id of
 * one of its payments; any other pair is the storefront's not-found.
 */
const CheckoutPaidPage = async ({ params, searchParams }: CheckoutPaidPageProps) => {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const parsed = paidQuerySchema.safeParse(query);
  const store = parsed.success ? await getStoreBySlug(slug) : null;
  const view =
    parsed.success && store
      ? await getCheckoutPaidView({
          storeId: store.id,
          reservationId: parsed.data.reservation,
          stripeCheckoutSessionId: parsed.data.session_id,
        })
      : null;

  if (!parsed.success || !store || !view) {
    notFound();
  }

  const [t, tOutcome, tCheckout] = await Promise.all([
    getTranslations("storefront.checkout.paid"),
    getTranslations("storefront.account.outcome"),
    getTranslations("storefront.checkout.cancelled"),
  ]);
  const received = view.state === "received";
  const values = { number: view.number, store: store.name };
  const description = received
    ? t(view.confirmationByEmail ? "receivedEmailed" : "received", values)
    : t(view.confirmationByEmail ? "confirmingEmailed" : "confirming", values);
  const loginHref = buildLoginPath({
    redirect: `/account/reservations/${parsed.data.reservation}?event=paid`,
  });

  return (
    <StorefrontSection width="narrow">
      <ReservationCartReset event="paid" />
      {received ? null : <StorefrontPageRefresh renderedAt={Date.now()} />}
      <OutcomeHeader
        tone={received ? "success" : "pending"}
        icon={received ? <CheckIcon /> : <ClockIcon />}
        title={received ? tOutcome("payment_received.title") : tOutcome("processing.title")}
        description={description}
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
