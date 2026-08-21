"use client";

import { useState, useTransition } from "react";

import { Download, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toastManager,
} from "@louez/ui";

import {
  acceptPurchaseInvoice,
  acknowledgePurchaseInvoice,
  refusePurchaseInvoice,
  type ReceivedInvoiceActionResult,
} from "./actions";
import { PurchaseInvoiceAcceptDialog } from "./purchase-invoice-accept-dialog";
import { PurchaseInvoiceRefuseDialog } from "./purchase-invoice-refuse-dialog";
import {
  getReceivedInvoiceActionAvailability,
  type ReceivedInvoiceAction,
} from "./util.purchase-invoices";

type PurchaseInvoiceActionsProps = {
  invoiceNumber: string;
  ourAction: ReceivedInvoiceAction;
  receivedInvoiceId: string;
};

/** Download plus the three lifecycle statements available on one inbox row. */
export const PurchaseInvoiceActions = ({
  invoiceNumber,
  ourAction,
  receivedInvoiceId,
}: PurchaseInvoiceActionsProps) => {
  const t = useTranslations("dashboard.purchaseInvoices.actions");
  const tErrors = useTranslations("errors");
  const [isPending, startTransition] = useTransition();
  const [openDialog, setOpenDialog] = useState<"accept" | "refuse" | null>(null);

  const availability = getReceivedInvoiceActionAvailability(ourAction);

  const run = (
    perform: () => Promise<ReceivedInvoiceActionResult>,
    successKey: "acceptSuccess" | "acknowledgeSuccess" | "refuseSuccess",
  ) => {
    startTransition(async () => {
      const result = await perform();

      if (result.status === "error") {
        const key = result.error.replace("errors.", "");
        toastManager.add({
          title: tErrors.has(key) ? tErrors(key) : tErrors("generic"),
          type: "error",
        });
        return;
      }

      setOpenDialog(null);
      toastManager.add({ title: t(successKey), type: "success" });
    });
  };

  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        size="sm"
        variant="outline"
        render={
          <a
            href={`/api/purchase-invoices/${receivedInvoiceId}`}
            aria-label={t("downloadNamed", { number: invoiceNumber })}
          />
        }
      >
        <Download data-slot="icon" />
        <span className="max-sm:sr-only">{t("download")}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={isPending}
              aria-label={t("menuLabel", { number: invoiceNumber })}
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!availability.canAcknowledge || isPending}
            onClick={() =>
              run(() => acknowledgePurchaseInvoice(receivedInvoiceId), "acknowledgeSuccess")
            }
          >
            {t("acknowledge")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!availability.canAccept || isPending}
            onClick={() => setOpenDialog("accept")}
          >
            {t("accept")}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            disabled={!availability.canRefuse || isPending}
            onClick={() => setOpenDialog("refuse")}
          >
            {t("refuse")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PurchaseInvoiceAcceptDialog
        invoiceNumber={invoiceNumber}
        isPending={isPending}
        onConfirm={() => run(() => acceptPurchaseInvoice(receivedInvoiceId), "acceptSuccess")}
        onOpenChange={(open) => setOpenDialog(open ? "accept" : null)}
        open={openDialog === "accept"}
      />
      <PurchaseInvoiceRefuseDialog
        invoiceNumber={invoiceNumber}
        isPending={isPending}
        onConfirm={(reason) =>
          run(() => refusePurchaseInvoice(receivedInvoiceId, reason || undefined), "refuseSuccess")
        }
        onOpenChange={(open) => setOpenDialog(open ? "refuse" : null)}
        open={openDialog === "refuse"}
      />
    </div>
  );
};
