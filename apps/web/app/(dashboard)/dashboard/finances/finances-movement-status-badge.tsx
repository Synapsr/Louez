"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import type { FinanceMovementStatus } from "@louez/validations";

import { STATUS_BADGE_VARIANTS } from "./finances.constants";

interface FinancesMovementStatusBadgeProps {
  status: FinanceMovementStatus;
}

/** Settled is the rule and shows nothing: only what still needs attention gets a badge. */
export const FinancesMovementStatusBadge = ({ status }: FinancesMovementStatusBadgeProps) => {
  const t = useTranslations("dashboard.finances.status");

  if (status === "settled") return null;

  return (
    <Badge variant={STATUS_BADGE_VARIANTS[status]} size="sm">
      {t(status)}
    </Badge>
  );
};
