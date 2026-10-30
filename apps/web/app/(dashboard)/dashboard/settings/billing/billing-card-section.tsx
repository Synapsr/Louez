"use client";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { CreditCardIcon, ShieldCheckIcon } from "@louez/ui/icons";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import type { BillingOverviewView, BillingSavedCard } from "@/lib/billing-sync/pages";

import { BillingCardStatus } from "./billing-card-status";
import { useCardSetup } from "./use-card-setup";

type BillingCardSectionProps = {
  card: BillingOverviewView["card"];
  savedCard: BillingSavedCard | null;
  /** Why no card can be added now; null when one can. */
  unavailable: BillingOverviewView["cardSetupUnavailable"];
  /** A platform admin sees the card and changes nothing. */
  readOnly: boolean;
};

/**
 * The billing card: the one on file, as Stripe last told the service, and "Add a card"
 * or "Replace card", which opens Stripe Checkout and comes back here.
 */
export const BillingCardSection = ({
  card,
  savedCard,
  unavailable,
  readOnly,
}: BillingCardSectionProps) => {
  const t = useTranslations("dashboard.settings.billing.card");
  const setup = useCardSetup();
  const canChange = !readOnly && unavailable === null;

  return (
    <DashboardSectionCard
      title={t("title")}
      description={t("description")}
      icon={CreditCardIcon}
      accent={card === "missing" || savedCard?.expired ? "pending" : "neutral"}
      contentClassName="space-y-4"
    >
      <BillingCardStatus card={card} savedCard={savedCard} />

      {canChange && (
        <div className="space-y-2">
          <Button onClick={setup.start} isPending={setup.opening}>
            {setup.opening ? t("opening") : savedCard ? t("replace") : t("add")}
          </Button>
          {setup.failed ? (
            <p className="text-destructive text-sm" role="alert">
              {t("startFailed")}
            </p>
          ) : (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <ShieldCheckIcon className="size-4 shrink-0" />
              {t("stripeNote")}
            </p>
          )}
        </div>
      )}
      {!readOnly && unavailable === "off" && (
        <p className="text-muted-foreground text-sm">{t("off")}</p>
      )}
    </DashboardSectionCard>
  );
};
