import { getLocale, getTranslations } from "next-intl/server";

import type { BusinessHours } from "@louez/types";
import { cn } from "@louez/utils";

import { StoreStatusBadge } from "@/components/storefront/store-status-badge";
import { SectionHeader } from "@/components/storefront/ui/section-header";
import { formatStoreDate } from "@/lib/utils/store-date";
import { buildOpeningHoursRows, getUpcomingClosures } from "@/lib/utils/util.opening-hours";
import { getStoreStatus } from "@/lib/utils/util.store-status";

interface OpeningHoursCardProps {
  businessHours: BusinessHours | undefined;
  timezone: string | undefined;
}

/** Opening hours as a Monday-first table, today's status on top, exceptional closures below. */
export const OpeningHoursCard = async ({ businessHours, timezone }: OpeningHoursCardProps) => {
  const [t, locale] = await Promise.all([getTranslations("storefront.about"), getLocale()]);
  const rows = buildOpeningHoursRows(businessHours, locale);
  const closures = getUpcomingClosures(businessHours?.closurePeriods);

  return (
    <section aria-labelledby="about-hours" className="flex flex-col gap-4">
      <SectionHeader
        id="about-hours"
        level="h2"
        title={t("hoursTitle")}
        action={
          <StoreStatusBadge
            businessHours={businessHours}
            timezone={timezone}
            initialStatus={getStoreStatus(businessHours, timezone)}
          />
        }
        className="mb-0"
      />
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noHours")}</p>
      ) : (
        <dl className="divide-y divide-border rounded-2xl bg-muted px-4 sm:px-6">
          {rows.map((row) => (
            <div key={row.days} className="flex items-start justify-between gap-4 py-3 text-sm">
              <dt className="font-medium capitalize">{row.days}</dt>
              <dd
                className={cn(
                  "flex flex-col items-end tabular-nums",
                  row.isOpen ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {row.isOpen
                  ? row.ranges.map((range) => <span key={range}>{range}</span>)
                  : t("closed")}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {closures.length > 0 ? (
        <div className="flex flex-col gap-1 text-sm">
          <p className="font-medium">{t("closuresTitle")}</p>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            {closures.map((closure) => (
              <li key={closure.id}>
                {closure.name} ·{" "}
                {closure.startDate === closure.endDate
                  ? formatStoreDate(new Date(closure.startDate), timezone, "d MMM", locale)
                  : `${formatStoreDate(new Date(closure.startDate), timezone, "d MMM", locale)} – ${formatStoreDate(new Date(closure.endDate), timezone, "d MMM", locale)}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
};
