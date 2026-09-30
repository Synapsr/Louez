"use client";

import { Globe, Lock, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import { Badge } from "@louez/ui";

import { CustomerFieldTargetSummary } from "./customer-field-target-summary";
import { describeTargeting } from "./util.customer-field-online";

interface CustomerFieldBadgesProps {
  field: CustomerFieldDefinition;
}

/**
 * Under a field of the canvas, only what changes how it behaves: required,
 * sensitive, asked online, limited to a customer type or to some products.
 * Nothing at all for a plain field.
 */
export const CustomerFieldBadges = ({ field }: CustomerFieldBadgesProps) => {
  const t = useTranslations("dashboard.settings.customerFields.badges");
  const isCustomer = field.scope === "customer";
  const targeting = describeTargeting(field);
  const badges = [
    isCustomer && field.isRequired,
    field.isSensitive,
    field.collectMode !== "never",
    isCustomer && field.appliesTo !== "all",
    targeting.kind === "empty" || targeting.kind === "targets",
  ];
  if (!badges.some(Boolean)) return null;

  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      {isCustomer && field.isRequired && <Badge variant="secondary">{t("required")}</Badge>}
      {field.isSensitive && (
        <Badge variant="secondary">
          <Lock aria-hidden />
          {t("sensitive")}
        </Badge>
      )}
      {field.collectMode !== "never" && (
        <Badge variant="info">
          <Globe aria-hidden />
          {t(`online.${field.collectMode}`)}
        </Badge>
      )}
      {isCustomer && field.appliesTo !== "all" && (
        <Badge variant="outline">{t(field.appliesTo)}</Badge>
      )}
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
