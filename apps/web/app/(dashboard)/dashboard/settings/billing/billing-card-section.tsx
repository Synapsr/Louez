"use client";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { CreditCardIcon, ShieldCheckIcon } from "@louez/ui/icons";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import type {
  BillingBalance as BillingBalanceView,
  BillingOverviewView,
  BillingSavedCard,
} from "@/lib/billing-sync/pages";

import { BillingBalance } from "./billing-balance";
import { BillingCardStatus } from "./billing-card-status";
import { useCardSetup } from "./use-card-setup";

type BillingCardSectionProps = {
  card: BillingOverviewView["card"];
  savedCard: BillingSavedCard | null;
  /** The unpaid balance and its limit; null when the service does not invoice the store. */
  balance: BillingBalanceView | null;
  /** The overview's `add_card` notice: a card would pay the statements on their own. */
  asksForCard: boolean;
  /** Why no card can be added now; null when one can. */
  unavailable: BillingOverviewView["cardSetupUnavailable"];
  /** A platform admin sees the card and changes nothing. */
  readOnly: boolean;
};

/**
 * The billing card: the one on file, as Stripe last told the service, the unpaid
 * balance, and "Add a card" or "Replace card", which opens Stripe Checkout and comes
 * back here.
 */
export const BillingCardSection = ({
  card,
  savedCard,
  balance,
  asksForCard,
  unavailable,
  readOnly,
}: BillingCardSectionProps) => {
  const t = useTranslations("dashboard.settings.billing.card");
  const setup = useCardSetup();
  const canChange = !readOnly && unavailable === null;
  const needsAttention =
    card === "missing" || savedCard?.expired || (balance !== null && balance.standing !== "ok");

  return (
    <DashboardSectionCard
      title={t("title")}
      description={t("description")}
      icon={CreditCardIcon}
      accent={needsAttention ? "pending" : "neutral"}
      contentClassName="space-y-4"
    >
      <BillingCardStatus card={card} savedCard={savedCard} />
      {balance && <BillingBalance balance={balance} />}
      {asksForCard && <p className="text-muted-foreground text-sm">{t("addCardNotice")}</p>}

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
