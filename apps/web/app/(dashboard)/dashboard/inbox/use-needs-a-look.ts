"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { useStore } from "@/contexts/store-context";
import { useNeedsALookFormat } from "@/hooks/use-needs-a-look-format";
import { acknowledgeNeedsALook, type NeedsALookItem } from "@/lib/inbox/needs-a-look";
import { orpcClientForStore } from "@/lib/orpc/client";
import { needsALookQueries } from "@/lib/queries/needs-a-look.queries";
import { apiErrorKey } from "@/lib/orpc/errors";

/**
 * The page's list and its "Mark as handled": an item marked leaves at once;
 * the page (`router.refresh`) and the notification bell are read again, and
 * so is the list after a refusal or an item that changed in the meantime.
 */
export const useNeedsALook = (items: NeedsALookItem[]) => {
  const t = useTranslations("dashboard.needsALook");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const queryClient = useQueryClient();
  const { storeId } = useStore();
  /** The page from the server, the notification bell from the API. */
  const refresh = () => {
    router.refresh();
    void queryClient.invalidateQueries({ queryKey: needsALookQueries.summaryKey(storeId) });
  };
  const format = useNeedsALookFormat();
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());

  const acknowledge = useMutation({
    // The store the page shows, whatever the session's active store became since.
    mutationFn: (item: NeedsALookItem) =>
      acknowledgeNeedsALook(orpcClientForStore(storeId).dashboard.inbox, item),
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
