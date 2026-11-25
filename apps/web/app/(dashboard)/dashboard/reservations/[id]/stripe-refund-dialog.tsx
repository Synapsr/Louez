"use client";

import { useTranslations } from "next-intl";
import { useIsMutating, useQuery } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";

import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Skeleton,
} from "@louez/ui";

import { stripeRefundsMutations, stripeRefundsQueries } from "@/lib/queries/stripe-refunds.queries";

import { StripeRefundForm } from "./stripe-refund-form";
import { useStripeRefundRefusalText } from "./use-stripe-refund-refusal-text";
import { stripeRefundRefusalOf } from "./util.stripe-refund";

interface StripeRefundDialogProps {
  paymentId: string;
  reservationId: string;
  reservationStatus: string;
  customerName: string;
  onClose: () => void;
}

/**
 * Refunds a payment taken online, all or part of it, back to the card or means that
 * paid it. What it can give back is read from Stripe when the dialog opens; a payment
 * that cannot be refunded now says why instead of showing the form. While a refund is
 * being sent, nothing closes the dialog (Cancel, Escape, a click outside, a swipe): its
 * answer comes back to it.
 */
export const StripeRefundDialog = ({
  paymentId,
  reservationId,
  reservationStatus,
  customerName,
  onClose,
}: StripeRefundDialogProps) => {
  const t = useTranslations("dashboard.reservations.payment.stripeRefund");
  const tCommon = useTranslations("common");
  const refusalText = useStripeRefundRefusalText();
  const preview = useQuery(stripeRefundsQueries.preview(paymentId));
  const sending = useIsMutating({ mutationKey: stripeRefundsMutations.refundKey() }) > 0;

  return (
    <Dialog open onOpenChange={(open) => !open && !sending && onClose()}>
      <DialogPopup className="max-w-md" showCloseButton={!sending}>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        {preview.data ? (
          <StripeRefundForm
            preview={preview.data}
            reservationId={reservationId}
            reservationStatus={reservationStatus}
            customerName={customerName}
            onClose={onClose}
          />
        ) : (
          <>
            <DialogPanel>
              {preview.isError ? (
                <Alert variant="error">
                  <AlertCircleIcon />
                  <AlertDescription>
                    {refusalText(stripeRefundRefusalOf(preview.error))}
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-3" aria-busy="true" aria-label={t("loading")}>
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-32 w-full" />
                </div>
              )}
            </DialogPanel>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {tCommon("close")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogPopup>
    </Dialog>
  );
};
