"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import type { BusinessHours } from "@louez/types";

import type { RentalPeriodValue } from "@/components/storefront/date-picker/core/types";
import { RentalPeriodPicker } from "@/components/storefront/date-picker/rental-period-picker";
import { postEmbedHeight } from "@/lib/embed/util.embed-messaging";
import type { PricingMode } from "@/lib/utils/duration";
import type { RentalPeriodRules } from "@/lib/utils/util.rental-period";

interface EmbedDatePickerProps {
  rentalUrl: string;
  pricingMode: PricingMode;
  businessHours?: BusinessHours;
  advanceNotice?: number;
  minRentalMinutes?: number;
  maxRentalMinutes?: number | null;
  timezone?: string;
  deliveryEnabled?: boolean;
}

/**
 * Iframe widget: fields, an inline compact editor and a CTA that opens the
 * dated catalog in a new tab. Reports its height to the host page so the
 * iframe grows with the editor.
 */
export const EmbedDatePicker = ({
  rentalUrl,
  pricingMode,
  businessHours,
  advanceNotice = 0,
  minRentalMinutes = 60,
  maxRentalMinutes = null,
  timezone,
}: EmbedDatePickerProps) => {
  const tEmbed = useTranslations("storefront.embed");
  const [value, setValue] = useState<RentalPeriodValue | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // The host script sizes the iframe from this message. Measure the widget's
  // own box, page padding included: inside an iframe `documentElement` is at
  // least as tall as the frame, so it can only ever report growth.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      // A detached or still-collapsed widget would tell the host to hide it.
      if (height > 0) postEmbedHeight(height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  const openRentalPage = (period: RentalPeriodValue) => {
    const params = new URLSearchParams({
      startDate: period.start.toISOString(),
      endDate: period.end.toISOString(),
    });
    window.open(`${rentalUrl}?${params.toString()}`, "_blank", "noopener");
  };

  return (
    // The padding lives here, not on the page, so the observed box is the
    // whole document and the reported height needs no correction.
    <div ref={containerRef} className="w-full p-2">
      <div className="flex flex-col gap-3 rounded-2xl bg-card p-3 text-card-foreground shadow-card">
        <h2 className="text-center text-sm font-semibold tracking-tight">{tEmbed("title")}</h2>
        <RentalPeriodPicker
          layout="embed"
          value={value}
          onChange={(period) => {
            setValue(period);
            openRentalPage(period);
          }}
          onSubmit={openRentalPage}
          submitLabel={tEmbed("cta")}
          rules={rules}
          showTimezoneNotice
        />
      </div>
    </div>
  );
};
