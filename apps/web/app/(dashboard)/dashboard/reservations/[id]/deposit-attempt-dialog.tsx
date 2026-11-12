"use client";

import { useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
  toastManager,
} from "@louez/ui";

import { apiErrorKey } from "@/lib/orpc/errors";
import { invalidateReservationAll } from "@/lib/orpc/invalidation";
import { orpc } from "@/lib/orpc/react";

const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/;

/**
 * The way out of a deposit hold Stripe never confirmed: the store says what its Stripe
 * dashboard shows, nothing, or the PaymentIntent (packages/api
 * routers/dashboard/deposit-attempts.ts).
 */
export const DepositAttemptDialog = ({
  reservationId,
  open,
  onOpenChange,
}: {
  reservationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const t = useTranslations("dashboard.reservations.deposit.unconfirmed");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const [paymentIntentId, setPaymentIntentId] = useState("");

  const resolve = useMutation(
    orpc.dashboard.reservations.resolveDepositAttempt.mutationOptions({
      onSettled: async () => {
        // A refusal may have recorded what Stripe holds: the page reads it again.
        await invalidateReservationAll(queryClient, reservationId);
      },
    }),
  );

  const submit = async (
    resolution: { kind: "nothing_at_stripe" } | { kind: "payment_intent"; paymentIntentId: string },
  ) => {
    try {
      const result = await resolve.mutateAsync({ reservationId, resolution });
      toastManager.add({
        title: result.outcome === "closed" ? t("closed") : t("recorded"),
        type: "success",
      });
      setPaymentIntentId("");
      onOpenChange(false);
    } catch (error) {
      toastManager.add({ title: tErrors(apiErrorKey(error) ?? "generic"), type: "error" });
    }
  };

  const trimmed = paymentIntentId.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("nothingTitle")}</p>
              <p className="text-xs text-muted-foreground">{t("nothingDescription")}</p>
              <Button
                variant="outline"
                className="w-full"
                isPending={
                  resolve.isPending && resolve.variables?.resolution.kind === "nothing_at_stripe"
                }
                disabled={resolve.isPending}
                onClick={() => submit({ kind: "nothing_at_stripe" })}
              >
                {t("nothingAction")}
              </Button>
            </div>
            <div className="space-y-2 border-t pt-4">
              <Label htmlFor="deposit-attempt-payment-intent">{t("foundTitle")}</Label>
              <p className="text-xs text-muted-foreground">{t("foundDescription")}</p>
              <Input
                id="deposit-attempt-payment-intent"
                value={paymentIntentId}
                onChange={(event) => setPaymentIntentId(event.target.value)}
                placeholder="pi_..."
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                className="w-full"
                isPending={
                  resolve.isPending && resolve.variables?.resolution.kind === "payment_intent"
                }
                disabled={resolve.isPending || !PAYMENT_INTENT_ID.test(trimmed)}
                onClick={() => submit({ kind: "payment_intent", paymentIntentId: trimmed })}
              >
                {t("foundAction")}
              </Button>
            </div>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
};
