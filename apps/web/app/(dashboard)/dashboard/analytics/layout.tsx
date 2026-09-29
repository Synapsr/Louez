import { AnalyticsLayoutContent } from "@/app/(dashboard)/dashboard/analytics/analytics-layout-content";

import { UnifiedPeriodFilter } from "./unified-period-filter";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * Header shared by the analytics sub-pages (sales, traffic): the title and the
 * period filter stay put while only the section below swaps.
 */
export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AnalyticsLayoutContent periodFilter={<UnifiedPeriodFilter className="shrink-0" />}>
      {children}
    </AnalyticsLayoutContent>
  );
}
