"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  toastManager,
} from "@louez/ui";

import { apiErrorKey } from "@/lib/orpc/errors";
import { invalidateReservationAll } from "@/lib/orpc/invalidation";
import { orpc } from "@/lib/orpc/react";

/**
 * The way out of a deposit hold Stripe never confirmed: the store closes it, after it
 * checked its Stripe dashboard. Louez looks the attempt up first, and records what it
 * finds instead (packages/api routers/dashboard/deposit-attempts.ts).
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
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const resolve = useMutation(
    orpc.dashboard.reservations.resolveDepositAttempt.mutationOptions({
      onSettled: async () => {
        await invalidateReservationAll(queryClient, reservationId);
      },
    }),
  );

  const close = async () => {
    try {
      const result = await resolve.mutateAsync({ reservationId });
      toastManager.add({
        title: result.outcome === "closed" ? t("closed") : t("recorded"),
        type: "success",
      });
      onOpenChange(false);
    } catch (error) {
      toastManager.add({ title: tErrors(apiErrorKey(error) ?? "generic"), type: "error" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <p className="text-sm text-muted-foreground">{t("explanation")}</p>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button isPending={resolve.isPending} disabled={resolve.isPending} onClick={close}>
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
