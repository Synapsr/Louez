"use client";

import { useState } from "react";

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
  Label,
  Textarea,
} from "@louez/ui";

const REFUSAL_REASON_MAX_LENGTH = 500;

type PurchaseInvoiceRefuseDialogProps = {
  invoiceNumber: string;
  isPending: boolean;
  onConfirm: (reason: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/**
 * Refusing posts `fr:210` with an optional reason that travels to the supplier
 * through the PDP network — hence a real dialog rather than a bare confirm.
 */
export const PurchaseInvoiceRefuseDialog = ({
  invoiceNumber,
  isPending,
  onConfirm,
  onOpenChange,
  open,
}: PurchaseInvoiceRefuseDialogProps) => {
  const t = useTranslations("dashboard.purchaseInvoices.refuse");
  const tCommon = useTranslations("common");
  const [reason, setReason] = useState("");

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setReason("");
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description", { number: invoiceNumber })}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="space-y-2">
            <Label htmlFor="purchase-invoice-refusal-reason">
              {t("reasonLabel")}{" "}
              <span className="text-muted-foreground font-normal">({tCommon("optional")})</span>
            </Label>
            <Textarea
              id="purchase-invoice-refusal-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={REFUSAL_REASON_MAX_LENGTH}
              placeholder={t("reasonPlaceholder")}
              rows={3}
            />
            <p className="text-muted-foreground text-sm">{t("reasonHelp")}</p>
          </div>
        </DialogPanel>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isPending}
          >
            {tCommon("cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onConfirm(reason.trim())}
            disabled={isPending}
            isPending={isPending}
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
