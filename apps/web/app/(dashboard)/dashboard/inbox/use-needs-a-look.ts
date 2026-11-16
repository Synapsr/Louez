"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { useStore } from "@/contexts/store-context";
import { useFormatLocale } from "@/hooks/use-format-locale";
import { acknowledgeNeedsALook, type NeedsALookItem } from "@/lib/inbox/needs-a-look";
import type { DisplayFormat } from "@/lib/inbox/needs-a-look-display";
import { orpcClient } from "@/lib/orpc";
import { needsALookQueries } from "@/lib/queries/needs-a-look.queries";
import { apiErrorKey } from "@/lib/orpc/errors";
import { formatCurrency } from "@/lib/utils";
import { formatStoreDate } from "@/lib/utils/store-date";

/**
 * The page's list and its "Mark as handled": an item marked leaves at once;
 * the page (`router.refresh`), the sidebar's dot and the home's line are read
 * again, and so is the list after a refusal or an item that changed in the
 * meantime. Money and days read as the dashboard writes
 * them, in the store's time zone.
 */
export const useNeedsALook = (items: NeedsALookItem[]) => {
  const t = useTranslations("dashboard.needsALook");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  /** The page from the server, the sidebar's marker and the home's line from the API. */
  const refresh = () => {
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: needsALookQueries.summaryKey() });
  };
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
      refresh();
    },
    onError: (error) => {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
      refresh();
    },
  });

  return {
    format,
    visible: items.filter((item) => !handled.has(item.id)),
    acknowledge: (item: NeedsALookItem) => acknowledge.mutateAsync(item).catch(() => undefined),
    pendingId: acknowledge.isPending ? (acknowledge.variables?.id ?? null) : null,
  };
};
