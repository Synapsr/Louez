"use client";

import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { openTestStorefront } from "./util.open-test-storefront";

/**
 * The success toast of the store's first product: it says the store is
 * ready and offers the test reservation. A test still running opens its page.
 */
export function useFirstProductToast() {
  const t = useTranslations("dashboard.testReservation");

  return (title: string) => {
    toastManager.add({
      title,
      description: t("toast.description"),
      type: "success",
      timeout: 15_000,
      actionProps: {
        children: t("start"),
        onClick: () => {
          openTestStorefront()
            .then((result) => {
              if ("existing" in result) {
                window.location.assign(`/dashboard/reservations/${result.existing}`);
              }
            })
            .catch(() => toastManager.add({ title: t("startError"), type: "error" }));
        },
      },
    });
  };
}
