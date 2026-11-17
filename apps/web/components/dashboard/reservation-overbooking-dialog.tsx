"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import { shortfallChoice, type CapacityShortfall } from "@louez/api/contracts/reservations";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";

type ReservationOverbookingDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The lines the stock, or the turnover buffer, cannot cover, as the server listed them. */
  shortfalls: CapacityShortfall[];
  /**
   * What confirming writes: a new reservation, the edit of one, or its
   * confirmation, over the stock; or its confirmation past the turnover
   * buffer, for lines that fit the stock only without it.
   */
  intent: "create" | "edit" | "confirm" | "confirmPastBuffer";
  isPending: boolean;
  onConfirm: () => void;
};

const WORDING = {
  create: {
    title: "title",
    description: "description",
    shortfall: "shortfall",
    action: "createAnyway",
  },
  edit: {
    title: "title",
    description: "editDescription",
    shortfall: "shortfall",
    action: "saveAnyway",
  },
  confirm: {
    title: "title",
    description: "confirmDescription",
    shortfall: "shortfall",
    action: "confirmAnyway",
  },
  confirmPastBuffer: {
    title: "bufferTitle",
    description: "bufferDescription",
    shortfall: "bufferShortfall",
    action: "confirmPastBuffer",
  },
} as const;

/**
 * What the dashboard shows when the server refused a reservation for lack of
 * stock, or of time between two rentals: each shortfall, and the choice to
 * go past it. The choice is kept in the reservation's history.
 */
export const ReservationOverbookingDialog = ({
  open,
  onOpenChange,
  shortfalls,
  intent,
  isPending,
  onConfirm,
}: ReservationOverbookingDialogProps) => {
  const t = useTranslations("dashboard.reservations.manualForm.overbooking");
  const tCommon = useTranslations("common");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="text-destructive h-5 w-5" />
            {t(WORDING[intent].title)}
          </DialogTitle>
          <DialogDescription>{t(WORDING[intent].description)}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            {shortfalls.map((shortfall, index) => {
              // The combination, or what a line open on it chose (a confirmation's).
              const choice = shortfallChoice(shortfall);
              return (
                <div
                  // Two lines of one product may both be short: a confirmation's
                  // names its line; a creation's and an edit's, their position.
                  key={
                    shortfall.reservationItemId ??
                    `${shortfall.productId}:${shortfall.combinationKey || "product"}:${index}`
                  }
                  className="rounded-md border p-3"
                >
                  <p className="text-sm font-medium">{shortfall.productName}</p>
                  {choice && (
                    <p className="text-muted-foreground mt-1 text-xs">
                      {t("combination", { combination: choice })}
                    </p>
                  )}
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t(WORDING[intent].shortfall, {
                      requested: shortfall.requested,
                      available: shortfall.available,
                    })}
                  </p>
                </div>
              );
            })}
          </div>
        </DialogPanel>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" variant="destructive" isPending={isPending} onClick={onConfirm}>
            {t(WORDING[intent].action)}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
