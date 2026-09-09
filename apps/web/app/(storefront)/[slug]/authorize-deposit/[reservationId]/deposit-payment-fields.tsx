"use client";

import { PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useMutation } from "@tanstack/react-query";
import { ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, AlertDescription, Button } from "@louez/ui";

import { useStorefrontBasePath } from "@/contexts/store-context";
import { useFormatMoney } from "@/hooks/use-format-money";
import { resolveStorefrontHref } from "@/lib/util.storefront-href";

import { confirmDepositAuthorization, type DepositAuthorizationError } from "./actions";

interface DepositPaymentFieldsProps {
  slug: string;
  reservationId: string;
  token: string;
  depositAmount: number;
  currency: string;
}

type SubmitOutcome =
  | { ok: true }
  | { ok: false; message: string | null; error?: DepositAuthorizationError | "unexpected_status" };

const CONFIRM_ERROR_KEYS: Record<DepositAuthorizationError | "unexpected_status", string> = {
  store_not_found: "errors.generic",
  reservation_not_found: "errors.notFound",
  invalid_token: "errors.invalidToken",
  stripe_not_configured: "errors.stripeNotConfigured",
  deposit_already_authorized: "errors.alreadyAuthorized",
  no_deposit_required: "errors.noDepositRequired",
  payment_intent_creation_failed: "paymentInitError",
  not_authorized: "errors.notAuthorized",
  confirmation_failed: "confirmationError",
  unexpected_status: "unexpectedStatus",
};

/**
 * The card fields and the one button of the deposit page. Stripe confirms the
 * hold (3DS inline when needed), the server re-reads the intent and records
 * it, then the browser leaves for the reservation page right away.
 */
export const DepositPaymentFields = ({
  slug,
  reservationId,
  token,
  depositAmount,
  currency,
}: DepositPaymentFieldsProps) => {
  const t = useTranslations("storefront.authorizeDeposit");
  const formatMoney = useFormatMoney();
  const basePath = useStorefrontBasePath() ?? "";
  const stripe = useStripe();
  const elements = useElements();
  const [isReady, setIsReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async (): Promise<SubmitOutcome> => {
      if (!stripe || !elements) {
        return { ok: false, message: null, error: "unexpected_status" };
      }

      const returnPath = resolveStorefrontHref(
        basePath,
        `/authorize-deposit/${reservationId}/success?token=${encodeURIComponent(token)}`,
      );
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: `${window.location.origin}${returnPath}` },
        redirect: "if_required",
      });

      if (error) {
        return { ok: false, message: error.message ?? null };
      }
      if (!paymentIntent || paymentIntent.status !== "requires_capture") {
        return { ok: false, message: null, error: "unexpected_status" };
      }

      const result = await confirmDepositAuthorization({
        slug,
        reservationId,
        token,
        paymentIntentId: paymentIntent.id,
      });
      if (!result.ok) {
        return { ok: false, message: null, error: result.error };
      }

      window.location.assign(result.redirectUrl);
      return { ok: true };
    },
  });

  const outcome = submit.data;
  const failure = submit.isError
    ? t("unexpectedError")
    : outcome && !outcome.ok
      ? (outcome.message ?? t(CONFIRM_ERROR_KEYS[outcome.error ?? "unexpected_status"]))
      : loadError;
  const isLeaving = outcome?.ok === true;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit.mutate();
      }}
    >
      <PaymentElement
        options={{ layout: "tabs" }}
        onReady={() => setIsReady(true)}
        onLoadError={() => setLoadError(t("paymentInitError"))}
      />

      {failure ? (
        <Alert variant="error">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}

      <Button
        type="submit"
        size="xl"
        className="h-12 w-full lg:h-10"
        disabled={!stripe || !elements || !isReady}
        isPending={submit.isPending || isLeaving}
        pendingContent={isLeaving ? t("redirecting") : t("processing")}
      >
        <ShieldCheckIcon data-slot="icon" />
        {t("authorizeButton", { amount: formatMoney(depositAmount, { currency }) })}
      </Button>

      <p className="text-center text-xs text-muted-foreground">{t("securePayment")}</p>
    </form>
  );
};
