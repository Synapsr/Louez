"use client";

import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  Button,
} from "@louez/ui";

type PurchaseInvoiceAcceptDialogProps = {
  invoiceNumber: string;
  isPending: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

/**
 * Accepting posts `fr:205` to the PDP network — a legal statement that cannot
 * be walked back, so it is confirmed rather than fired from the menu.
 */
export const PurchaseInvoiceAcceptDialog = ({
  invoiceNumber,
  isPending,
  onConfirm,
  onOpenChange,
  open,
}: PurchaseInvoiceAcceptDialogProps) => {
  const t = useTranslations("dashboard.purchaseInvoices.accept");
  const tCommon = useTranslations("common");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup className="sm:max-w-[460px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("description", { number: invoiceNumber })}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {tCommon("cancel")}
          </Button>
          <Button type="button" onClick={onConfirm} disabled={isPending} isPending={isPending}>
            {t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
};
