"use client";

import { EyeOff, Globe, Lock, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import type { CustomerFormItemFlags } from "./util.customer-form-builder";

interface CustomerFieldBadgesProps {
  flags: CustomerFormItemFlags | null;
}

/**
 * Under an item, only what changes how it behaves: hidden, required by the
 * team, sensitive, asked online, or limited to no product at all. Nothing
 * for a plain field.
 */
export const CustomerFieldBadges = ({ flags }: CustomerFieldBadgesProps) => {
  const t = useTranslations("dashboard.settings.customerFields.badges");
  if (!flags) return null;
  const { hidden, required, sensitive, collectMode, noTarget } = flags;
  if (!hidden && !required && !sensitive && collectMode === "never" && !noTarget) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {hidden && (
        <Badge variant="secondary">
          <EyeOff aria-hidden />
          {t("hidden")}
        </Badge>
      )}
      {required && <Badge variant="secondary">{t("required")}</Badge>}
      {collectMode !== "never" && (
        <Badge variant="info">
          <Globe aria-hidden />
          {t(`online.${collectMode}`)}
        </Badge>
      )}
      {sensitive && (
        <Badge variant="secondary">
          <Lock aria-hidden />
          {t("sensitive")}
        </Badge>
      )}
      {noTarget && (
        <Badge variant="warning">
          <TriangleAlert aria-hidden />
          {t("noTarget")}
        </Badge>
      )}
    </div>
  );
};
