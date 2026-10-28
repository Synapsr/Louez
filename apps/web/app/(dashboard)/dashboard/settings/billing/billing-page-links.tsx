import { getTranslations } from "next-intl/server";

import { BuildingIcon, CreditCardIcon, FileTextIcon } from "@louez/ui/icons";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { DashboardListRow } from "@/components/dashboard/shared/dashboard-list-row";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { billingHandoffHref } from "@/lib/billing/billing-routes";

/** The billing pages one click away, each through the hand-off (README §10, `to`). */
const PAGES = [
  { page: "/payment-method", key: "paymentMethod", icon: CreditCardIcon },
  { page: "/statements", key: "statements", icon: FileTextIcon },
  { page: "/details", key: "details", icon: BuildingIcon },
] as const;

export const BillingPageLinks = async () => {
  const t = await getTranslations("dashboard.settings.billing.pages");

  return (
    <DashboardSectionCard title={t("title")} contentClassName="space-y-1">
      {PAGES.map(({ page, key, icon }) => (
        <DashboardListRow
          key={page}
          href={billingHandoffHref(page)}
          documentLink
          leading={<DashboardIconTile icon={icon} size="sm" />}
          title={<span className="font-medium">{t(`${key}.title`)}</span>}
          subtitle={t(`${key}.description`)}
        />
      ))}
    </DashboardSectionCard>
  );
};
