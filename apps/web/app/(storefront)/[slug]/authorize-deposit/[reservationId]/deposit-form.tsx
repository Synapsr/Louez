"use client";

import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe, type StripeElementLocale } from "@stripe/stripe-js";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, Skeleton } from "@louez/ui";

import { Price } from "@/components/storefront/ui/price";

import { createDepositPaymentIntent, type DepositAuthorizationError } from "./actions";
import { DepositPaymentFields } from "./deposit-payment-fields";

interface DepositFormProps {
  slug: string;
  reservationId: string;
  token: string;
  depositAmount: number;
  currency: string;
  stripeAccountId: string;
  stripePublishableKey: string;
  locale: StripeElementLocale;
  theme: { primaryColor: string; mode: "light" | "dark" } | null;
}

const INTENT_ERROR_KEYS: Record<DepositAuthorizationError, string> = {
  store_not_found: "errors.generic",
  reservation_not_found: "errors.notFound",
  invalid_token: "errors.invalidToken",
  stripe_not_configured: "errors.stripeNotConfigured",
  deposit_already_authorized: "errors.alreadyAuthorized",
  no_deposit_required: "errors.noDepositRequired",
  payment_intent_creation_failed: "paymentInitError",
  not_authorized: "errors.notAuthorized",
  confirmation_failed: "confirmationError",
};

// One Stripe.js instance per connected account for the life of the page:
// re-renders and re-mounts reuse it instead of loading the script again.
const stripePromises = new Map<string, Promise<Stripe | null>>();

const getStripePromise = (publishableKey: string, stripeAccountId: string) => {
  const key = `${publishableKey}:${stripeAccountId}`;
  const existing = stripePromises.get(key);
  if (existing) {
    return existing;
  }
  const created = loadStripe(publishableKey, { stripeAccount: stripeAccountId });
  stripePromises.set(key, created);
  return created;
};

/** Stripe Elements follows the store theme: primary colour, mode, control radius. */
const buildAppearance = (theme: DepositFormProps["theme"]) => ({
  theme: theme?.mode === "dark" ? ("night" as const) : ("stripe" as const),
  variables: {
    colorPrimary: theme?.primaryColor,
    borderRadius: "8px",
    fontFamily: "Inter, system-ui, sans-serif",
    fontSizeBase: "16px",
  },
});

/**
 * Deposit hold form: amount, one info line, Stripe Elements. The intent is
 * created once per page; the fields and the submit live in
 * `DepositPaymentFields`.
 */
export const DepositForm = ({
  slug,
  reservationId,
  token,
  depositAmount,
  currency,
  stripeAccountId,
  stripePublishableKey,
  locale,
  theme,
}: DepositFormProps) => {
  const t = useTranslations("storefront.authorizeDeposit");
  const intent = useQuery({
    queryKey: ["storefront", "deposit-intent", slug, reservationId, token],
    queryFn: () => createDepositPaymentIntent({ slug, reservationId, token }),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const intentError = intent.isError
    ? t("paymentInitError")
    : intent.data && !intent.data.ok
      ? t(INTENT_ERROR_KEYS[intent.data.error])
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-1 rounded-2xl bg-muted p-4 text-center">
        <span className="text-xs text-muted-foreground">{t("depositAmount")}</span>
        <Price amount={depositAmount} size="xl" />
      </div>

      <Alert>
        <InfoIcon className="size-4" />
        <AlertDescription>{t("infoBox")}</AlertDescription>
      </Alert>

      {intent.isPending ? (
        <div className="flex flex-col gap-3" aria-busy>
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
      ) : intentError ? (
        <Alert variant="error">
          <AlertDescription>{intentError}</AlertDescription>
        </Alert>
      ) : intent.data?.ok ? (
        <Elements
          stripe={getStripePromise(stripePublishableKey, stripeAccountId)}
          options={{
            clientSecret: intent.data.clientSecret,
            appearance: buildAppearance(theme),
            locale,
          }}
        >
          <DepositPaymentFields
            slug={slug}
            reservationId={reservationId}
            token={token}
            depositAmount={depositAmount}
            currency={currency}
          />
        </Elements>
      ) : null}
    </div>
  );
};
