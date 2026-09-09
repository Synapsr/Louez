"use client";

import { useState } from "react";

import { CreditCardIcon, DownloadIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { ReservationConfirmDialog } from "@/components/storefront/account/reservation-confirm-dialog";
import { useReservationActions } from "@/components/storefront/account/use-reservation-actions";
import type { ReservationActions as ReservationActionSet } from "@/lib/reservations/util.reservation-actions";

interface ReservationActionsProps {
  storeSlug: string;
  reservationId: string;
  actions: ReservationActionSet;
  /** Absolute contract URL; a plain link so the browser handles the PDF. */
  contractHref: string;
}

type PendingDialog = "accept" | "decline" | null;

/**
 * The single actions zone of a reservation: one primary button (accept
 * the quote, pay) and its secondaries, sitting in the page's status bar.
 * Nothing renders when the customer has nothing to do and no contract to
 * download.
 */
export const ReservationActions = ({
  storeSlug,
  reservationId,
  actions,
  contractHref,
}: ReservationActionsProps) => {
  const t = useTranslations("storefront.account");
  const [dialog, setDialog] = useState<PendingDialog>(null);
  const { pay, accept, decline, error } = useReservationActions({ storeSlug, reservationId });

  const hasAnything = actions.canAcceptQuote || actions.canPay || actions.canDownloadContract;
  if (!hasAnything) return null;

  const isBusy = pay.isPending || accept.isPending || decline.isPending;
  const closeDialog = () => setDialog(null);

  return (
    <div className="flex flex-col gap-2 sm:shrink-0 sm:items-end">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {actions.canAcceptQuote ? (
          <>
            <Button
              size="xl"
              className="w-full sm:h-10 sm:w-auto"
              disabled={isBusy}
              onClick={() => setDialog("accept")}
            >
              {t("quote.accept")}
            </Button>
            <Button
              size="xl"
              variant="outline"
              className="w-full sm:h-10 sm:w-auto"
              disabled={isBusy}
              onClick={() => setDialog("decline")}
            >
              {t("quote.decline")}
            </Button>
          </>
        ) : null}

        {actions.canPay ? (
          <Button
            size="xl"
            className="w-full sm:h-10 sm:w-auto"
            isPending={pay.isPending}
            disabled={isBusy}
            onClick={() => pay.mutate()}
          >
            <CreditCardIcon data-slot="icon" />
            {t("payNow")}
          </Button>
        ) : null}

        {actions.canDownloadContract ? (
          <Button
            size="xl"
            variant={actions.canPay ? "ghost" : "outline"}
            className="w-full sm:h-10 sm:w-auto"
            render={<a href={contractHref} />}
          >
            <DownloadIcon data-slot="icon" />
            {t("downloadContract")}
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <ReservationConfirmDialog
        open={dialog === "accept"}
        onOpenChange={(open) => (open ? setDialog("accept") : closeDialog())}
        title={t("quote.acceptTitle")}
        description={t("quote.acceptDescription")}
        cancelLabel={t("quote.cancel")}
        confirmLabel={t("quote.confirmAccept")}
        isPending={accept.isPending}
        onConfirm={() => accept.mutate(undefined, { onSettled: closeDialog })}
      />
      <ReservationConfirmDialog
        open={dialog === "decline"}
        onOpenChange={(open) => (open ? setDialog("decline") : closeDialog())}
        title={t("quote.declineTitle")}
        description={t("quote.declineDescription")}
        cancelLabel={t("quote.cancel")}
        confirmLabel={t("quote.confirmDecline")}
        destructive
        isPending={decline.isPending}
        onConfirm={() => decline.mutate(undefined, { onSettled: closeDialog })}
      />
    </div>
  );
};
