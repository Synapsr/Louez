"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { CreditCardIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { resumeCheckoutPayment, type ResumeCheckoutPaymentResult } from "./actions";

interface ResumePaymentButtonProps {
  slug: string;
  reservationId: string;
}

type ResumeFailure = Extract<ResumeCheckoutPaymentResult, { ok: false }>;
type ResumeError = Exclude<
  ResumeFailure["error"],
  "already_paid" | "reservation_changed" | "amount_too_small"
>;

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
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const resume = useMutation({
    mutationFn: () => resumeCheckoutPayment({ slug, reservationId }),
    onSuccess: (result) => {
      if (result.ok) {
        window.location.assign(result.url);
      } else if (result.error === "already_paid" || result.error === "reservation_changed") {
        // The page reads the booking again: paid, or what remains of it.
        router.refresh();
      }
    },
  });

  const failed: ResumeFailure | null = resume.data && !resume.data.ok ? resume.data : null;
  const paid = failed?.error === "already_paid";
  const failure = !failed
    ? resume.isError
      ? t("errors.sessionFailed")
      : null
    : failed.error === "already_paid"
      ? null
      : failed.error === "reservation_changed"
        ? tErrors("reservationChangedMeanwhile")
        : failed.error === "amount_too_small"
          ? tErrors("paymentAmountTooSmall", {
              minimumAmount: failed.minimumAmount,
              currency: failed.currency,
            })
          : t(`errors.${ERROR_MESSAGE_KEYS[failed.error]}`);

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
      {paid ? <p className="text-xs text-muted-foreground">{t("alreadyPaidTitle")}</p> : null}
      {failure ? <p className="text-xs text-destructive">{failure}</p> : null}
    </div>
  );
};
