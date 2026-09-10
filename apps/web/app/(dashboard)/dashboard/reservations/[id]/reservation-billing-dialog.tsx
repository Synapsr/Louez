"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { ReservationBillingSnapshot } from "@louez/types";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
  Switch,
  toastManager,
} from "@louez/ui";

import { orpc } from "@/lib/orpc/react";
import { invalidateReservationAll } from "@/lib/orpc/invalidation";

interface ReservationBillingDialogProps {
  reservationId: string;
  billing: ReservationBillingSnapshot;
  onClose: () => void;
}

const BILLING_ERROR_KEYS = new Set([
  "companyNameRequired",
  "invalidCompanyNumber",
  "invalidVatNumber",
]);

/**
 * Edits who this reservation is billed to. Only the reservation's billing
 * snapshot changes; the customer profile keeps its own default.
 */
export const ReservationBillingDialog = ({
  reservationId,
  billing,
  onClose,
}: ReservationBillingDialogProps) => {
  const t = useTranslations("dashboard.reservations.billing");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const router = useRouter();
  const [isBusiness, setIsBusiness] = useState(billing.customerType === "business");
  const [companyName, setCompanyName] = useState(billing.companyName ?? "");
  const [companyNumber, setCompanyNumber] = useState(billing.companyNumber ?? "");
  const [vatNumber, setVatNumber] = useState(billing.vatNumber ?? "");

  const updateBillingMutation = useMutation(
    orpc.dashboard.reservations.updateBilling.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservationId);
      },
    }),
  );

  const handleSave = async () => {
    if (isBusiness && companyName.trim().length === 0) {
      toastManager.add({ title: t("errors.companyNameRequired"), type: "error" });
      return;
    }
    try {
      await updateBillingMutation.mutateAsync({
        reservationId,
        customerType: isBusiness ? "business" : "individual",
        companyName: isBusiness ? companyName : "",
        companyNumber: isBusiness ? companyNumber : "",
        vatNumber: isBusiness ? vatNumber : "",
      });
      toastManager.add({ title: t("saved"), type: "success" });
      router.refresh();
      onClose();
    } catch (error) {
      const key =
        error instanceof Error && error.message.startsWith("errors.")
          ? error.message.replace("errors.", "")
          : null;
      const title =
        key && BILLING_ERROR_KEYS.has(key)
          ? t(`errors.${key}`)
          : key
            ? tErrors(key)
            : tErrors("generic");
      toastManager.add({ title, type: "error" });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("edit")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <Label className="flex min-h-11 items-center justify-between gap-3">
              <span>{t("business")}</span>
              <Switch checked={isBusiness} onCheckedChange={setIsBusiness} />
            </Label>
            {isBusiness && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="reservation-billing-company-name">{t("companyName")}</Label>
                  <Input
                    id="reservation-billing-company-name"
                    value={companyName}
                    onChange={(event) => setCompanyName(event.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reservation-billing-company-number">{t("companyNumber")}</Label>
                  <Input
                    id="reservation-billing-company-number"
                    value={companyNumber}
                    onChange={(event) => setCompanyNumber(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reservation-billing-vat-number">{t("vatNumber")}</Label>
                  <Input
                    id="reservation-billing-vat-number"
                    value={vatNumber}
                    onChange={(event) => setVatNumber(event.target.value)}
                  />
                </div>
              </>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleSave} isPending={updateBillingMutation.isPending}>
            {tCommon("save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
