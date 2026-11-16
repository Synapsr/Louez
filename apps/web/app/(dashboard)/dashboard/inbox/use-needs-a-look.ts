"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { useStore } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { acknowledgeNeedsALook, type NeedsALookItem } from "@/lib/inbox/needs-a-look";
import type { DisplayFormat } from "@/lib/inbox/needs-a-look-display";
import { orpcClient } from "@/lib/orpc";
import { apiErrorKey } from "@/lib/orpc/errors";
import { formatCurrency } from "@/lib/utils";
import { formatStoreDate } from "@/lib/utils/store-date";

/**
 * The page's list and its "Mark as handled": an item marked leaves at once;
 * the page and the sidebar's dot are read again from the server
 * (`router.refresh`), and so is the list after a refusal or an item that
 * changed in the meantime. Money and days read as the dashboard writes
 * them, in the store's time zone.
 */
export const useNeedsALook = (items: NeedsALookItem[]) => {
  const t = useTranslations("dashboard.needsALook");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const { timezone } = useStore();
  const { intl } = useFormatLocale();
  const format: DisplayFormat = {
    money: (amount, currency) => formatCurrency(Number(amount), currency, intl),
    day: (iso) => formatStoreDate(iso, timezone, "SHORTEST_DATE", intl),
  };
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());

  const acknowledge = useMutation({
    mutationFn: (item: NeedsALookItem) => acknowledgeNeedsALook(orpcClient.dashboard.inbox, item),
    onSuccess: (outcome, item) => {
      if (outcome === "handled") {
        setHandled((current) => new Set(current).add(item.id));
        toastManager.add({ title: t("handled"), type: "success" });
      } else {
        toastManager.add({ title: t("changed"), type: "info" });
      }
      router.refresh();
    },
    onError: (error) => {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
      router.refresh();
    },
  });

  return {
    format,
    visible: items.filter((item) => !handled.has(item.id)),
    acknowledge: (item: NeedsALookItem) => acknowledge.mutateAsync(item).catch(() => undefined),
    pendingId: acknowledge.isPending ? (acknowledge.variables?.id ?? null) : null,
  };
};
