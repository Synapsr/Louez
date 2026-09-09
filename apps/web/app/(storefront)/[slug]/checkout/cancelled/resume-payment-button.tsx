"use client";

import { useMutation } from "@tanstack/react-query";
import { CreditCardIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { resumeCheckoutPayment, type ResumeCheckoutPaymentResult } from "./actions";

interface ResumePaymentButtonProps {
  slug: string;
  reservationId: string;
}

type ResumeError = Extract<ResumeCheckoutPaymentResult, { ok: false }>["error"];

const ERROR_MESSAGE_KEYS: Record<
  ResumeError,
  "notFound" | "invalidStatus" | "unavailable" | "sessionFailed"
> = {
  not_found: "notFound",
  invalid_status: "invalidStatus",
  payment_unavailable: "unavailable",
  session_failed: "sessionFailed",
};

/** Primary action of the cancelled page: back to Stripe, same reservation. */
export const ResumePaymentButton = ({ slug, reservationId }: ResumePaymentButtonProps) => {
  const t = useTranslations("storefront.checkout.cancelled");
  const resume = useMutation({
    mutationFn: () => resumeCheckoutPayment({ slug, reservationId }),
    onSuccess: (result) => {
      if (result.ok) {
        window.location.assign(result.url);
      }
    },
  });

  const failure =
    resume.data && !resume.data.ok
      ? t(`errors.${ERROR_MESSAGE_KEYS[resume.data.error]}`)
      : resume.isError
        ? t("errors.sessionFailed")
        : null;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto">
      <Button
        size="xl"
        className="h-12 w-full lg:h-10 sm:w-auto"
        isPending={resume.isPending || (resume.data?.ok ?? false)}
        pendingContent={t("redirecting")}
        onClick={() => resume.mutate()}
      >
        <CreditCardIcon data-slot="icon" />
        {t("resume")}
      </Button>
      {failure ? <p className="text-xs text-destructive">{failure}</p> : null}
    </div>
  );
};
