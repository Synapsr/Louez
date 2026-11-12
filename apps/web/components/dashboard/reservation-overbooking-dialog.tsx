"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CapacityShortfall } from "@louez/api/services/reservation-inventory";
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
  /** The lines the stock cannot cover, as the server listed them. */
  shortfalls: CapacityShortfall[];
  /** What confirming writes: a new reservation, or the edit of one. */
  intent: "create" | "edit";
  isPending: boolean;
  onConfirm: () => void;
};

/**
 * What the dashboard shows when the server refused a reservation for lack of
 * stock: each shortfall, and the choice to book over it. The override is kept
 * in the reservation's history.
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
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {intent === "edit" ? t("editDescription") : t("description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            {shortfalls.map((shortfall, index) => (
              <div
                // Two lines of one product may both be short: the position tells them apart.
                key={`${shortfall.productId}:${shortfall.combinationKey || "product"}:${index}`}
                className="rounded-md border p-3"
              >
                <p className="text-sm font-medium">{shortfall.productName}</p>
                {shortfall.combinationKey && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("combination", { combination: shortfall.combinationKey })}
                  </p>
                )}
                <p className="text-muted-foreground mt-1 text-sm">
                  {t("shortfall", {
                    requested: shortfall.requested,
                    available: shortfall.available,
                  })}
                </p>
              </div>
            ))}
          </div>
        </DialogPanel>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {tCommon("cancel")}
          </Button>
          <Button type="button" variant="destructive" isPending={isPending} onClick={onConfirm}>
            {intent === "edit" ? t("saveAnyway") : t("createAnyway")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
