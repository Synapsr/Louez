"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { useTranslations } from "next-intl";

import { RefreshCw } from "lucide-react";

import { Button, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import { syncPurchaseInvoices } from "./actions";

/**
 * Pulls the latest received invoices and statuses from the PDP on demand —
 * the cron does the same every minute, this is for the impatient click.
 */
export const SyncPurchaseInvoicesButton = () => {
  const t = useTranslations("dashboard.purchaseInvoices");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleSync = () => {
    startTransition(async () => {
      const result = await syncPurchaseInvoices();
      if (result.status === "error") {
        toastManager.add({ title: tErrors("generic"), type: "error" });
        return;
      }
      router.refresh();
    });
  };

  return (
    <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={handleSync}>
      <RefreshCw data-slot="icon" className={cn(isPending && "animate-spin")} />
      {t("sync")}
    </Button>
  );
};
