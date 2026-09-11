"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { BusinessHours } from "@louez/types";

import type { PricingMode } from "@/lib/utils/duration";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";
import type { StoreReassuranceKey } from "@/lib/utils/util.store-reassurance";

import { EmbedCta } from "./embed-cta";
import { EmbedPeriodField } from "./embed-period-field";
import { EmbedPeriodPanel } from "./embed-period-panel";
import { EmbedReassurance } from "./embed-reassurance";
import { useEmbedHeightReport } from "./use-embed-height-report";
import { useEmbedPeriod } from "./use-embed-period";
import { embedStepField, embedStepPart, toEmbedPeriodStep } from "./util.embed-period-steps";

const SLOT_INTERVAL_MINUTES = 30;
const EMPTY_TIME = "--:--";

interface EmbedPeriodWidgetProps {
  rentalUrl: string;
  pricingMode: PricingMode;
  businessHours?: BusinessHours;
  advanceNotice?: number;
  minRentalMinutes?: number;
  maxRentalMinutes?: number | null;
  timezone?: string;
  reassurance: StoreReassuranceKey[];
}

/**
 * The iframe widget: two fields split in day and time, an editor that
 * unfolds under them, one CTA that opens the dated catalog in a new tab.
 * The first fill is guided half by half; later taps edit one half.
 */
export const EmbedPeriodWidget = ({
  rentalUrl,
  pricingMode,
  businessHours,
  advanceNotice = 0,
  minRentalMinutes = 60,
  maxRentalMinutes = null,
  timezone,
  reassurance,
}: EmbedPeriodWidgetProps) => {
  const t = useTranslations("storefront.embed");
  const tFields = useTranslations("storefront.dateSelection");
  const containerRef = useEmbedHeightReport<HTMLDivElement>();

  const rules = useMemo<RentalPeriodRules>(
    () => ({
      pricingMode,
      businessHours,
      timezone,
      advanceNoticeMinutes: advanceNotice,
      minRentalMinutes,
      maxRentalMinutes,
    }),
    [pricingMode, businessHours, timezone, advanceNotice, minRentalMinutes, maxRentalMinutes],
  );

  const period = useEmbedPeriod(rules);
  const { core, editing, labels } = period;
  const activeField = editing.active ? embedStepField(editing.active) : null;
  const activePart = editing.active ? embedStepPart(editing.active) : null;

  const openRentalPage = () => {
    if (!core.period || !core.canSubmit) {
      // Without a period the CTA starts the guided fill instead of sulking.
      if (!core.hasDates) period.tap("startDate");
      return;
    }
    const params = new URLSearchParams({
      startDate: core.period.start.toISOString(),
      endDate: core.period.end.toISOString(),
    });
    window.open(`${rentalUrl}?${params.toString()}`, "_blank", "noopener");
  };

  return (
    // The padding lives here, not on the page, so the observed box is the
    // whole document and the reported height needs no correction.
    <div ref={containerRef} className="w-full p-2">
      <div className="@container flex flex-col gap-3 rounded-2xl bg-card p-3 text-card-foreground shadow-card sm:p-4">
        <h2 className="text-center text-base font-semibold tracking-tight">{t("title")}</h2>
        {/* The panel belongs to the fields' block: folded, it costs no gap. */}
        <div className="flex flex-col">
          <div className="grid grid-cols-2 gap-2 sm:gap-3">
            <EmbedPeriodField
              label={tFields("startLabel")}
              day={labels.startDay ?? t("dayPlaceholder")}
              dayCompact={labels.startDayCompact ?? t("dayPlaceholder")}
              time={core.startDate ? core.startTime : EMPTY_TIME}
              empty={!core.startDate}
              active={activeField === "start" ? activePart : null}
              onTap={(part) => period.tap(toEmbedPeriodStep("start", part))}
            />
            <EmbedPeriodField
              label={tFields("endLabel")}
              day={labels.endDay ?? t("dayPlaceholder")}
              dayCompact={labels.endDayCompact ?? t("dayPlaceholder")}
              time={core.endDate ? core.endTime : EMPTY_TIME}
              empty={!core.endDate}
              active={activeField === "end" ? activePart : null}
              onTap={(part) => period.tap(toEmbedPeriodStep("end", part))}
            />
          </div>
          <EmbedPeriodPanel period={period} slotIntervalMinutes={SLOT_INTERVAL_MINUTES} />
        </div>
        {period.message ? (
          <p role="status" className="text-center text-xs text-destructive">
            {period.message}
          </p>
        ) : null}
        <EmbedCta
          ready={core.canSubmit}
          label={t("cta")}
          hint={core.hasDates ? t("checkDates") : t("chooseDates")}
          onClick={openRentalPage}
        />
        <EmbedReassurance items={reassurance} />
      </div>
    </div>
  );
};
