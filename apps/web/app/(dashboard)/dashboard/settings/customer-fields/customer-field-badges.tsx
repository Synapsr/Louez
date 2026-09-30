"use client";

import { EyeOff, Globe, Lock, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";

import { CustomerFieldTargetSummary } from "./customer-field-target-summary";
import type { CanvasFieldFlags } from "./util.customer-field-canvas";

interface CustomerFieldBadgesProps {
  flags: CanvasFieldFlags;
}

/**
 * Under a field of the canvas, only what changes how it behaves: a Louez
 * field, hidden, required, sensitive, asked online, limited to a customer
 * type or to some products. Nothing at all for a plain store field.
 */
export const CustomerFieldBadges = ({ flags }: CustomerFieldBadgesProps) => {
  const t = useTranslations("dashboard.settings.customerFields.badges");
  const { targeting } = flags;
  const badges = [
    flags.louez,
    flags.hidden,
    flags.required,
    flags.sensitive,
    flags.collectMode !== "never",
    flags.appliesTo !== "all",
    targeting.kind === "empty" || targeting.kind === "targets",
  ];
  if (!badges.some(Boolean)) return null;

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      {flags.louez && <Badge variant="outline">{t("louez")}</Badge>}
      {flags.hidden && (
        <Badge variant="secondary">
          <EyeOff aria-hidden />
          {t("hidden")}
        </Badge>
      )}
      {flags.required && <Badge variant="secondary">{t("required")}</Badge>}
      {flags.sensitive && (
        <Badge variant="secondary">
          <Lock aria-hidden />
          {t("sensitive")}
        </Badge>
      )}
      {flags.collectMode !== "never" && (
        <Badge variant="info">
          <Globe aria-hidden />
          {t(`online.${flags.collectMode}`)}
        </Badge>
      )}
      {flags.appliesTo !== "all" && <Badge variant="outline">{t(flags.appliesTo)}</Badge>}
      {targeting.kind === "empty" && (
        <Badge variant="warning">
          <TriangleAlert aria-hidden />
          {t("noTarget")}
        </Badge>
      )}
      {targeting.kind === "targets" && <CustomerFieldTargetSummary targets={targeting.targets} />}
    </div>
  );
};
