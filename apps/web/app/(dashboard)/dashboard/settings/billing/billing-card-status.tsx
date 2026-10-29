"use client";

import { useTranslations } from "next-intl";

import { cardBrandName } from "@/lib/billing/billing-format";
import type { BillingOverviewView, BillingSavedCard } from "@/lib/billing-sync/pages";

/** The card on file, its expiry, or why there is none. */
export const BillingCardStatus = ({
  card,
  savedCard,
}: {
  card: BillingOverviewView["card"];
  savedCard: BillingSavedCard | null;
}) => {
  const t = useTranslations("dashboard.settings.billing.card");
  if (card === "saved" && savedCard) {
    const expiry =
      savedCard.expMonth !== null && savedCard.expYear !== null
        ? `${String(savedCard.expMonth).padStart(2, "0")}/${savedCard.expYear}`
        : null;
    return (
      <div className="space-y-1">
        <p className="font-medium">
          {savedCard.last4
            ? t("saved", {
                brand: cardBrandName(savedCard.brand) ?? t("otherBrand"),
                last4: savedCard.last4,
              })
            : t("onFile")}
        </p>
        {expiry && (
          <p
            className={
              savedCard.expired ? "text-destructive text-sm" : "text-muted-foreground text-sm"
            }
          >
            {savedCard.expired ? t("expired", { date: expiry }) : t("expires", { date: expiry })}
          </p>
        )}
      </div>
    );
  }
  const text = {
    saved: t("onFile"),
    missing: t("missing"),
    unknown: t("unknown"),
    not_needed: t("notNeeded"),
    in_louez: t("inLouez"),
  }[card];
  return <p className="text-muted-foreground text-sm">{text}</p>;
};
