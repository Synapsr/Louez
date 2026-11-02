"use client";

import { usePathname } from "next/navigation";

import { useTranslations } from "next-intl";

import { SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem } from "@louez/ui";
import { BillingGlassIcon } from "@louez/ui/icons/glass";

import { SidebarLink } from "@/components/dashboard/sidebar-link";
import { BILLING_SETTINGS_PATH } from "@/lib/billing/billing-routes";

/**
 * The sidebar's reminder that the card gate pauses new reservations (louez-billing
 * docs/api, README §8.4), next to the banner every dashboard page shows. Only for who
 * can open the billing page: it leads there, where the store takes them again.
 */
export const ReservationsPausedSidebarItem = () => {
  const t = useTranslations("dashboard.settings.billing.status");
  const pathname = usePathname();

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={
          pathname === BILLING_SETTINGS_PATH || pathname.startsWith(`${BILLING_SETTINGS_PATH}/`)
        }
        render={<SidebarLink href={BILLING_SETTINGS_PATH} />}
        tooltip={t("blocked")}
      >
        <BillingGlassIcon />
        <span>{t("blocked")}</span>
      </SidebarMenuButton>
      {/* The same warning dot as the low AI credits, restated under the button's
          `peer-data-[size]` variant so it sits centred on these `h-10` rows. */}
      <SidebarMenuBadge className="bg-badge-warning-foreground peer-data-[size=default]/menu-button:top-4 size-2 min-w-0 rounded-full p-0" />
      {/* Collapsed sidebar: the badge is hidden by its own styles, so the icon
          carries the dot instead. */}
      <span
        aria-hidden
        className="bg-badge-warning-foreground ring-sidebar absolute top-1 right-1.5 hidden size-2.5 rounded-full ring-2 group-data-[collapsible=icon]:block"
      />
    </SidebarMenuItem>
  );
};
