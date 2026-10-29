import { getTranslations } from "next-intl/server";

import { Alert, AlertDescription, Badge } from "@louez/ui";
import { ShieldCheckIcon, WalletIcon, WarningIcon } from "@louez/ui/icons";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import type { BillingOverview } from "@/lib/billing/billing-overview";

type BillingOverviewCardProps = {
  overview: BillingOverview;
};

/**
 * The store's offer and card gate, from the cached policy: what Louez enforces now.
 * The labels are the service's words, shown as text.
 */
export const BillingOverviewCard = async ({ overview }: BillingOverviewCardProps) => {
  const t = await getTranslations("dashboard.settings.billing");
  const blocked = overview.blockedReason !== null;

  return (
    <DashboardSectionCard
      title={t("offerTitle")}
      icon={WalletIcon}
      accent={blocked ? "pending" : "success"}
      action={
        <Badge variant={blocked ? "warning" : "success"}>
          {blocked ? t("status.blocked") : t("status.accepting")}
        </Badge>
      }
      contentClassName="space-y-4"
    >
      {overview.offer ? (
        <p className="font-medium">{overview.offer}</p>
      ) : (
        <p className="text-muted-foreground text-sm">{t("offerPending")}</p>
      )}

      {overview.blockedReason && (
        <Alert variant="warning">
          <WarningIcon />
          <AlertDescription>{t(`blocked.${overview.blockedReason}`)}</AlertDescription>
        </Alert>
      )}

      {overview.notice && <p className="text-muted-foreground text-sm">{overview.notice}</p>}

      {overview.readOnly && (
        <Alert variant="info">
          <ShieldCheckIcon />
          <AlertDescription>{t("readOnly")}</AlertDescription>
        </Alert>
      )}
    </DashboardSectionCard>
  );
};
