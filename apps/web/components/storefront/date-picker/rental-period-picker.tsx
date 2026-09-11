"use client";

import type { SeasonalCalendarPricing } from "@/lib/utils/util.storefront-seasonal-pricing";

import { useState } from "react";
import { ArrowRightIcon, GlobeIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, PopoverTrigger } from "@louez/ui";
import { useDialogDrawerMediaQuery } from "@louez/ui/hooks/use-dialog-mode";
import { cn } from "@louez/utils";

import { useBrowserTimezoneCity } from "@/hooks/use-browser-timezone-city";
import {
  validateRentalPeriodSelection,
  type RentalPeriodRules,
} from "@/lib/utils/util.rental-period";

import type { RentalPeriodField, RentalPeriodValue } from "./core/types";
import { DateTimeField } from "./date-time-field";
import { PeriodChip } from "./period-chip";
import { PeriodEditor } from "./period-editor";
import { PeriodPopover } from "./period-popover";
import { PeriodSheet } from "./period-sheet";
import { usePeriodIssueMessage } from "./use-period-issue-message";

export type RentalPeriodPickerLayout = "inline" | "compact" | "sheet" | "embed";

export interface RentalPeriodPickerProps {
  /**
   * `inline`: two fields and a CTA (hero, product page);
   * `compact`: a chip (catalog, header);
   * `sheet`: a controlled modal with no trigger (checkout);
   * `embed`: fields with an inline editor for the iframe widget.
   */
  layout: RentalPeriodPickerLayout;
  /** The committed period; the editor drafts from it. */
  value: RentalPeriodValue | null;
  seasonalPricing?: SeasonalCalendarPricing;
  /** Called when the customer taps "Valider". */
  onChange: (period: RentalPeriodValue) => void;
  /**
   * `inline` and `embed` only: the CTA under the fields. With a valid period
   * it fires; without one it opens the picker, so it is never disabled.
   */
  onSubmit?: (period: RentalPeriodValue) => void;
  submitLabel?: string;
  rules: RentalPeriodRules;
  /** Extra calendar floor for callers that only know a minimum date. */
  minDate?: Date;
  /** `sheet` only: controlled visibility. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  showTimezoneNotice?: boolean;
  className?: string;
}

const fieldsRowClassName = "grid w-full grid-cols-2 gap-2 sm:gap-3";
const fieldTriggerClassName =
  "min-w-0 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The one period picker of the storefront. A bottom sheet under `sm`, a
 * popover above, the same editor inside; the layout only decides what the
 * customer taps to open it.
 */
export const RentalPeriodPicker = ({
  layout,
  value,
  seasonalPricing,
  onChange,
  onSubmit,
  submitLabel,
  rules,
  minDate,
  open: openProp,
  onOpenChange,
  title,
  showTimezoneNotice = false,
  className,
}: RentalPeriodPickerProps) => {
  const t = useTranslations("storefront.dateSelection");
  const isPhone = useDialogDrawerMediaQuery();
  const issueMessage = usePeriodIssueMessage();
  const timezoneCity = useBrowserTimezoneCity(showTimezoneNotice ? rules.timezone : undefined);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [initialField, setInitialField] = useState<RentalPeriodField>();

  const open = openProp ?? uncontrolledOpen;
  const setOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const validation = validateRentalPeriodSelection({
    start: value?.start,
    end: value?.end,
    rules,
  });
  const committedMessage = value ? issueMessage(validation) : null;

  const handleSubmit = () => {
    if (validation.ok && value && onSubmit) {
      onSubmit(value);
      return;
    }
    setInitialField(undefined);
    setOpen(true);
  };

  const sheet = (
    <PeriodSheet
      seasonalPricing={seasonalPricing}
      open={open}
      onOpenChange={setOpen}
      value={value}
      initialField={initialField}
      rules={rules}
      minDate={minDate}
      title={title}
      onApply={onChange}
    />
  );

  if (layout === "sheet") {
    return sheet;
  }

  const fields = (["start", "end"] satisfies RentalPeriodField[]).map((field) => {
    const content = (
      <DateTimeField
        label={t(field === "start" ? "startLabel" : "endLabel")}
        value={value?.[field]}
        placeholder={t(field === "start" ? "startDate" : "endDate")}
        timezone={rules.timezone}
        size={layout === "embed" ? "compact" : "default"}
      />
    );
    if (isPhone || layout === "embed") {
      return (
        <button
          key={field}
          type="button"
          className={fieldTriggerClassName}
          onClick={() => {
            setInitialField(field);
            setOpen(layout === "embed" && initialField === field ? !open : true);
          }}
        >
          {content}
        </button>
      );
    }
    return (
      <PopoverTrigger
        key={field}
        className={fieldTriggerClassName}
        onClick={() => setInitialField(field)}
      >
        {content}
      </PopoverTrigger>
    );
  });

  const cta = onSubmit ? (
    <Button size="xl" className="h-12 w-full lg:h-10" onClick={handleSubmit}>
      {submitLabel ?? t("viewAvailability")}
      <ArrowRightIcon data-icon="end" aria-hidden />
    </Button>
  ) : null;

  const timezoneNotice = timezoneCity ? (
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <GlobeIcon className="size-3.5 shrink-0" aria-hidden />
      {t("timezoneNotice", { city: timezoneCity })}
    </p>
  ) : null;

  if (layout === "compact") {
    if (isPhone) {
      return (
        <>
          <PeriodChip
            period={value}
            timezone={rules.timezone}
            className={className}
            onClick={() => setOpen(true)}
          />
          {sheet}
        </>
      );
    }
    return (
      <PeriodPopover
        seasonalPricing={seasonalPricing}
        open={open}
        onOpenChange={setOpen}
        value={value}
        rules={rules}
        minDate={minDate}
        onApply={onChange}
      >
        <PeriodChip
          period={value}
          timezone={rules.timezone}
          className={className}
          render={<PopoverTrigger />}
          nativeButton
        />
      </PeriodPopover>
    );
  }

  if (layout === "embed") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div className={fieldsRowClassName}>{fields}</div>
        {open ? (
          <PeriodEditor
            seasonalPricing={seasonalPricing}
            value={value}
            initialField={initialField}
            rules={rules}
            minDate={minDate}
            variant="embed"
            onApply={(period) => {
              onChange(period);
              setOpen(false);
            }}
          />
        ) : null}
        {committedMessage && !open ? (
          <p role="status" className="text-xs text-destructive">
            {committedMessage}
          </p>
        ) : null}
        {cta}
        {timezoneNotice}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {isPhone ? (
        <>
          <div className={fieldsRowClassName}>{fields}</div>
          {sheet}
        </>
      ) : (
        <PeriodPopover
          seasonalPricing={seasonalPricing}
          open={open}
          onOpenChange={setOpen}
          value={value}
          initialField={initialField}
          rules={rules}
          minDate={minDate}
          onApply={onChange}
        >
          <div className={fieldsRowClassName}>{fields}</div>
        </PeriodPopover>
      )}
      {committedMessage ? (
        <p role="status" className="text-xs text-destructive">
          {committedMessage}
        </p>
      ) : null}
      {cta}
      {timezoneNotice}
    </div>
  );
};
