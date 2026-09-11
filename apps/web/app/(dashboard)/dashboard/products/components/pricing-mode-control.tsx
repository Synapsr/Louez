"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import { Separator } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { ModeGlyph } from "./pricing-curve";
import { useDurationFormat } from "./use-duration-format";
import type { PricingDraft } from "./use-pricing-draft";

const MODE_OPTIONS = [
  { prorated: false, glyph: "whole" as const, key: "calculationMode.whole.label" },
  { prorated: true, glyph: "prorated" as const, key: "calculationMode.prorated.label" },
];

/**
 * How a duration falling between two rates is billed. On screen from the first
 * rate on purpose: a lone base rate already bills differently in each mode (see
 * PRICING_METHOD.md, "Single-rate behavior"). Each option is named *and* priced,
 * because the gap between the two prices explains the choice better than prose.
 */
export function PricingModeControl({
  draft,
  currency,
  disabled,
  className,
  trailing,
  readOnly = false,
}: {
  draft: PricingDraft;
  currency: string;
  disabled: boolean;
  className?: string;
  /** Sits at the end of the same stretched row, behind a rule: it belongs to the
   *  row, but it is a tool for reading the choice rather than a third option. */
  trailing?: ReactNode;
  /** In a season the mode is the product's, so show which one applies and offer
   *  no choice — a disabled pair of options would only look broken. */
  readOnly?: boolean;
}) {
  const t = useTranslations("dashboard.products.form");
  const { short } = useDurationFormat();

  if (!draft.hasBaseRate) return null;
  const options = readOnly
    ? MODE_OPTIONS.filter((option) => option.prorated === draft.isProrated)
    : MODE_OPTIONS;

  return (
    <div className={className}>
      <p className="text-muted-foreground mb-1.5 text-xs">
        {t("calculationMode.example", { duration: short(draft.exampleMinutes) })}
      </p>
      <div className="flex flex-wrap items-stretch gap-1.5">
        {options.map((option) => {
          const isActive = option.prorated === draft.isProrated;
          const label = t(option.key as never);
          return (
            <button
              key={label}
              type="button"
              onClick={() => !readOnly && draft.setProrated(option.prorated)}
              disabled={disabled || readOnly}
              aria-pressed={readOnly ? undefined : isActive}
              className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${
                readOnly ? "cursor-default" : "disabled:pointer-events-none disabled:opacity-40"
              } ${
                isActive
                  ? "border-primary/50 bg-accent/50"
                  : "text-muted-foreground hover:border-foreground/20 hover:text-foreground border-transparent"
              }`}
            >
              <ModeGlyph
                mode={option.glyph}
                className={`h-4 w-6 shrink-0 ${isActive ? "text-primary" : "opacity-50"}`}
              />
              <span className="min-w-0">
                <span className="block text-sm leading-tight">{label}</span>
                <span
                  className={`block text-xs tabular-nums ${
                    isActive ? "text-foreground font-medium" : "text-muted-foreground/70"
                  }`}
                >
                  {formatCurrency(
                    draft.priceInMode(draft.exampleMinutes, option.prorated),
                    currency,
                  )}
                </span>
              </span>
            </button>
          );
        })}
        {trailing && (
          <div className="flex items-stretch gap-2 ps-0.5">
            <Separator orientation="vertical" />
            {trailing}
          </div>
        )}
      </div>
    </div>
  );
}
