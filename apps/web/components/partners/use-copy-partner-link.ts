"use client";

import { useCallback } from "react";

import { log } from "evlog/next/client";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

/** Copies the partner's link, and says so. */
export const useCopyPartnerLink = (link: string) => {
  const t = useTranslations("partnerSpace.link");
  return useCallback(async () => {
    try {
      await navigator.clipboard.writeText(link);
      toastManager.add({ title: t("copied"), type: "success" });
    } catch (error) {
      log.warn({ action: "partner_space_link_copy_failed", error: String(error) });
    }
  }, [link, t]);
};
