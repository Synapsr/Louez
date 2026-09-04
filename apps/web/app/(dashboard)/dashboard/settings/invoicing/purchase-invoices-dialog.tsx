"use client";

import { useState, type ReactNode } from "react";

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
} from "@louez/ui";

import { SyncPurchaseInvoicesButton } from "@/app/(dashboard)/dashboard/purchase-invoices/sync-purchase-invoices-button";

type PurchaseInvoicesDialogProps = {
  /** Server-rendered inbox content (table or empty state). */
  children: ReactNode;
};

/**
 * The supplier-invoice inbox opens in place while e-invoicing adoption is
 * low; the full page stays reachable for pagination and deep links.
 */
export const PurchaseInvoicesDialog = ({ children }: PurchaseInvoicesDialogProps) => {
  const t = useTranslations("dashboard.purchaseInvoices");
  const tSettings = useTranslations("dashboard.settings.invoicing.transmission");
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        {tSettings("purchaseInvoicesAction")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogPopup className="sm:max-w-4xl">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
              <DialogTitle>{t("title")}</DialogTitle>
              <SyncPurchaseInvoicesButton />
            </div>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          <DialogPanel className="max-h-[60vh] overflow-y-auto">{children}</DialogPanel>

          <DialogFooter>
            <Button variant="ghost" size="sm" render={<a href="/dashboard/purchase-invoices" />}>
              {t("viewAll")}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
};
