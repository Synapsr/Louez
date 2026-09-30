"use client";

import { useQuery } from "@tanstack/react-query";
import { Tag } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldTarget } from "@louez/types";

import { orpc } from "@/lib/orpc/react";

import { summarizeTargets } from "./util.customer-field-online";

interface CustomerFieldTargetSummaryProps {
  targets: CustomerFieldTarget[];
}

/** "Vélos & VAE, Vespa 125 +1": what a field is limited to, at a glance. */
export const CustomerFieldTargetSummary = ({ targets }: CustomerFieldTargetSummaryProps) => {
  const t = useTranslations("dashboard.settings.customerFields.online");
  const { data: options } = useQuery(orpc.dashboard.customerFields.targetOptions.queryOptions());

  if (!options) return null;
  const { names, more } = summarizeTargets(targets, options);
  if (names.length === 0) return null;
  const all = summarizeTargets(targets, options, targets.length).names.join(", ");

  return (
    <span
      title={all}
      className="text-muted-foreground inline-flex min-w-0 max-w-full items-center gap-1 text-xs"
    >
      <Tag aria-hidden className="size-3 shrink-0" />
      <span className="sr-only">{t("targetsSummaryLabel")}</span>
      <span className="truncate">{t("targetsSummary", { names: names.join(", "), more })}</span>
    </span>
  );
};
