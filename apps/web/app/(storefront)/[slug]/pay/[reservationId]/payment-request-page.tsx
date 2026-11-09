"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, Button, Checkbox, Label } from "@louez/ui";

import { Price } from "@/components/storefront/ui/price";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { StorefrontLink } from "@/components/storefront/ui/storefront-link";
import { useFormatMoney } from "@/hooks/use-format-money";

import { initiatePayment, type PaymentRequestError } from "./actions";

interface PaymentRequestPageProps {
  slug: string;
  storeName: string;
  reservation: { id: string; number: string };
  paymentRequest: { id: string; amount: number; currency: string; description: string };
  customerFirstName: string;
  /** Not signed yet: the customer accepts the rental terms before paying. */
  requiresContractAcceptance: boolean;
  token: string;
}

const ERROR_KEYS: Record<PaymentRequestError, string> = {
  store_not_found: "errors.errorDescription",
  reservation_not_found: "errors.errorDescription",
  invalid_token: "errors.expiredDescription",
  already_paid: "errors.alreadyPaidDescription",
  cancelled: "errors.cancelledDescription",
  stripe_not_configured: "errors.unavailableDescription",
  session_creation_failed: "errors.generic",
};

/**
 * Amount, one line, one button: the payment request as the customer sees it. A customer
 * who has not signed yet first ticks the rental terms; that is their signature.
 */
export const PaymentRequestPage = ({
  slug,
  storeName,
  reservation,
  paymentRequest,
  customerFirstName,
  requiresContractAcceptance,
  token,
}: PaymentRequestPageProps) => {
  const t = useTranslations("storefront.pay");
  const tErrors = useTranslations("errors");
  const formatMoney = useFormatMoney();
  const [contractAccepted, setContractAccepted] = useState(false);
  const [acceptanceMissing, setAcceptanceMissing] = useState(false);
  const pay = useMutation({
    mutationFn: () =>
      initiatePayment({
        slug,
        reservationId: reservation.id,
        paymentRequestId: paymentRequest.id,
        token,
        acceptContract: contractAccepted,
      }),
    onSuccess: (result) => {
      if (result.ok) {
        window.location.assign(result.url);
      }
    },
  });

  const formattedAmount = formatMoney(paymentRequest.amount, { currency: paymentRequest.currency });
  const failure = pay.isError
    ? t("errors.generic")
    : pay.data && !pay.data.ok
      ? pay.data.error === "amount_too_small"
        ? tErrors("paymentAmountTooSmall", {
            minimumAmount: pay.data.minimumAmount,
            currency: pay.data.currency,
          })
        : pay.data.error === "contract_not_accepted"
          ? null
          : t(ERROR_KEYS[pay.data.error])
      : null;
  const showAcceptanceError =
    acceptanceMissing || (pay.data?.ok === false && pay.data.error === "contract_not_accepted");
  const submit = () => {
    if (requiresContractAcceptance && !contractAccepted) {
      setAcceptanceMissing(true);
      return;
    }
    pay.mutate();
  };
  const isLeaving = pay.data?.ok === true;

  return (
    <>
      <SectionHeader
        level="h1"
        align="center"
        title={t("amountDue")}
        description={t("subtitle", { number: reservation.number })}
      />
      <div className="flex flex-col gap-4 rounded-2xl bg-card p-4 shadow-card sm:p-6">
        <div className="flex flex-col items-center gap-1 rounded-2xl bg-muted p-4 text-center">
          {paymentRequest.description ? (
            <span className="text-xs text-muted-foreground">{paymentRequest.description}</span>
          ) : null}
          <Price amount={paymentRequest.amount} size="xl" tone="primary" />
        </div>

        <p className="text-pretty text-sm text-muted-foreground">
          {t("greeting", { name: customerFirstName, store: storeName })}
        </p>

        {requiresContractAcceptance ? (
          <div className="flex flex-col gap-1">
            <div className="flex min-h-11 items-center gap-3">
              <Checkbox
                id="accept-contract"
                checked={contractAccepted}
                onCheckedChange={(checked) => {
                  setContractAccepted(Boolean(checked));
                  setAcceptanceMissing(false);
                }}
                aria-invalid={showAcceptanceError}
                aria-describedby={showAcceptanceError ? "accept-contract-error" : undefined}
              />
              <Label htmlFor="accept-contract" className="text-sm font-normal">
                {t.rich("acceptContractRich", {
                  terms: (chunks) => (
                    <StorefrontLink
                      href="/terms"
                      target="_blank"
                      className="underline underline-offset-2"
                    >
                      {chunks}
                    </StorefrontLink>
                  ),
                })}
              </Label>
            </div>
            {showAcceptanceError ? (
              <p id="accept-contract-error" className="text-xs text-destructive">
                {t("acceptContractRequired")}
              </p>
            ) : null}
          </div>
        ) : null}

        {failure ? (
          <Alert variant="error">
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}

        <Button
          size="xl"
          className="h-12 w-full lg:h-10"
          isPending={pay.isPending || isLeaving}
          pendingContent={t("redirecting")}
          onClick={submit}
        >
          <LockIcon data-slot="icon" />
          {t("payButton", { amount: formattedAmount })}
        </Button>

        <p className="text-center text-xs text-muted-foreground">{t("securePayment")}</p>
      </div>
    </>
  );
};
