"use client";

import { useRef, useState } from "react";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Input, Popover, PopoverPopup, PopoverTrigger, Slider } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { PriceDurationInput } from "@/components/ui/price-duration-input";

import { PricingModeControl } from "./pricing-mode-control";
import { PricingSecondaryOptions } from "./pricing-secondary-options";
import { PricingSimulator } from "./pricing-curve";
import type { PricingSectionProps } from "./pricing.types";
import { useDurationFormat } from "./use-duration-format";

/** Slider and typed input share one ceiling so they can never disagree. */
const MAX_DISCOUNT_PERCENT = 95;

/**
 * One continuous table: the base rate is simply the first rung, so there is no
 * "base rate" heading and no "additional rates" heading to read. Under it, how a
 * duration falling between two rates is billed, and the simulation on demand.
 *
 * Covers all three shapes a product's pricing can take — base rates, one season's
 * rates, and a flat fee.
 */
export function PricingLadder({
  draft,
  form,
  watchedValues,
  currency,
  currencySymbol,
  storeTaxSettings,
  disabled,
  scope = "base",
  onSwitchToBase,
  showValidationErrors = false,
  duplicateRateTierIndexes,
}: PricingSectionProps) {
  const t = useTranslations("dashboard.products.form");
  const tValidation = useTranslations("validation");
  const { short } = useDurationFormat();
  const hasTiers = draft.tiers.length > 0;
  const isSeason = scope === "season";
  const duplicateRows = new Set(duplicateRateTierIndexes ?? []);
  // A season is saved on its own and has no form field to read errors from.
  const missingBaseRate = !isSeason && showValidationErrors && !draft.hasBaseRate;

  const secondaryOptions = (
    <PricingSecondaryOptions
      form={form}
      watchedValues={watchedValues}
      currencySymbol={currencySymbol}
      storeTaxEnabled={Boolean(storeTaxSettings?.enabled)}
      storeTaxRate={storeTaxSettings?.defaultRate}
    />
  );

  // A flat fee has no duration, so the ladder, the mode and the curve all have
  // nothing to say — only the amount, and what is charged alongside it.
  if (scope === "fixed") {
    return (
      <div className="space-y-5">
        <div className="space-y-1.5">
          <span className="text-muted-foreground block text-xs">{t("fixedPrice")}</span>
          <div className="w-44">
            <form.AppField name="price">
              {(field) => (
                <field.Input suffix={currencySymbol} placeholder={t("pricePlaceholder")} />
              )}
            </form.AppField>
          </div>
        </div>
        {secondaryOptions}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="divide-y overflow-hidden rounded-xl border">
        <LadderRow invalid={missingBaseRate}>
          <div className="flex min-w-0 flex-col gap-1">
            <PriceDurationInput
              value={draft.baseRate}
              onChange={draft.setBaseRate}
              currency={currency}
              disabled={disabled}
              invalid={missingBaseRate}
            />
            {missingBaseRate && (
              <p className="text-destructive text-xs font-medium">{tValidation("positive")}</p>
            )}
          </div>
          <span className="text-muted-foreground ml-auto shrink-0 text-xs">
            {isSeason ? t("seasonReplacesBase") : t("minimumCharged")}
          </span>
        </LadderRow>

        {draft.tiers.map((tier, index) => {
          const economics = draft.tierEconomics(tier);
          const isDuplicate = duplicateRows.has(index);
          return (
            <LadderRow key={tier.id ?? `rate-${index}`} invalid={isDuplicate}>
              <div className="flex min-w-0 flex-col gap-1">
                <PriceDurationInput
                  value={{ price: tier.price, duration: tier.duration, unit: tier.unit }}
                  onChange={(next) =>
                    draft.updateTier(index, { ...tier, ...next, discountPercent: undefined })
                  }
                  currency={currency}
                  disabled={disabled}
                  invalid={isDuplicate}
                />
                {isDuplicate && (
                  <p className="text-destructive text-xs font-medium">
                    {t("pricingTiers.duplicateDurationError")}
                  </p>
                )}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <DiscountChip
                  value={Math.round(economics.discountPercent)}
                  reference={economics.reference}
                  currency={currency}
                  disabled={disabled || !draft.hasBaseRate}
                  onChange={(percent) => draft.setTierDiscount(index, percent)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground/40 hover:text-destructive h-7 w-7"
                  onClick={() => draft.removeTier(index)}
                  disabled={disabled}
                  aria-label={`${t("deleteSeason")} — ${short(economics.period)}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </LadderRow>
          );
        })}

        <button
          type="button"
          onClick={() => draft.addTier()}
          disabled={disabled || !draft.hasBaseRate}
          className="text-muted-foreground hover:bg-accent/40 hover:text-foreground flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus className="h-4 w-4" />
          {hasTiers ? t("addRate") : isSeason ? t("addSeasonRate") : t("pricingTiers.enableTiers")}
        </button>
      </div>

      <PricingModeControl
        draft={draft}
        currency={currency}
        disabled={disabled}
        readOnly={isSeason}
        trailing={
          <PricingSimulator
            draft={draft}
            currency={currency}
            disabled={disabled}
            align="end"
            className="self-stretch"
          />
        }
      />

      {isSeason ? (
        <p className="text-muted-foreground border-t pt-3 text-xs">
          {t("seasonalSettingsHint")}{" "}
          <button
            type="button"
            className="text-primary font-medium underline-offset-2 hover:underline"
            onClick={onSwitchToBase}
          >
            {t("switchToBasePricing")}
          </button>
        </p>
      ) : (
        secondaryOptions
      )}
    </div>
  );
}

function LadderRow({ children, invalid }: { children: React.ReactNode; invalid?: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-3 py-2.5 transition-colors ${
        invalid ? "bg-destructive/5" : "hover:bg-accent/20"
      }`}
    >
      {children}
    </div>
  );
}

/** The discount is a consequence of the price, so it stays a chip you can pull on. */
function DiscountChip({
  value,
  reference,
  currency,
  disabled,
  onChange,
}: {
  value: number;
  reference: number;
  currency: string;
  disabled?: boolean;
  onChange: (percent: number) => void;
}) {
  const t = useTranslations("dashboard.products.form");

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        disabled={disabled}
        className={`h-7 rounded-full px-2.5 text-xs font-medium tabular-nums transition-colors disabled:pointer-events-none disabled:opacity-40 ${
          value > 0
            ? "bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400"
            : "text-muted-foreground hover:bg-accent"
        }`}
      >
        {value > 0 ? `−${value} %` : t("pricingTiers.discount")}
      </PopoverTrigger>
      <PopoverPopup className="w-72" align="end">
        <div className="space-y-3 p-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground text-xs">{t("rateReduction")}</span>
            <PercentInput
              value={value}
              onCommit={onChange}
              disabled={disabled}
              label={t("rateReduction")}
            />
          </div>
          <Slider
            value={value}
            min={0}
            max={MAX_DISCOUNT_PERCENT}
            step={1}
            onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
          />
          {reference > 0 && (
            <p className="text-muted-foreground text-xs">
              {t("pricingTiers.insteadOf")}{" "}
              <span className="line-through">{formatCurrency(reference, currency)}</span>
            </p>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * Dragging is fine for exploring, useless for hitting 32 exactly — so the readout
 * is the input. Typing wins over the slider; both clamp to the same range.
 */
function PercentInput({
  value,
  onCommit,
  disabled,
  label,
}: {
  value: number;
  onCommit: (percent: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  function commit() {
    if (draft === null) return;
    const parsed = Number.parseFloat(draft.replace(",", "."));
    if (Number.isFinite(parsed)) {
      onCommit(Math.max(0, Math.min(MAX_DISCOUNT_PERCENT, Math.round(parsed))));
    }
    setDraft(null);
  }

  return (
    <div className="relative w-24 shrink-0">
      <Input
        ref={ref}
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_DISCOUNT_PERCENT}
        step={1}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            ref.current?.blur();
          }
          if (event.key === "Escape") {
            setDraft(null);
            ref.current?.blur();
          }
        }}
        disabled={disabled}
        aria-label={label}
        className="pr-7 text-sm [&_input]:[-moz-appearance:textfield] [&_input::-webkit-inner-spin-button]:appearance-none [&_input::-webkit-outer-spin-button]:appearance-none"
      />
      <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 z-10 flex items-center text-xs">
        %
      </span>
    </div>
  );
}
