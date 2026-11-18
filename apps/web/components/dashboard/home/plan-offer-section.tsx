import type { ReactNode } from "react";

import { getLocale } from "next-intl/server";

import { serverApi } from "@/lib/api/server-api";
import { formatMinor, formatPeriod } from "@/lib/billing/billing-format";
import { isBillingEnabled } from "@/lib/billing/mode";
import { log } from "@/lib/evlog";

import { HomeNextStepViewed } from "./home-next-step-viewed";
import { PlanOfferCard } from "./plan-offer-card";

/**
 * The home's offer of a plan that would have cost the store less than what it paid
 * Louez (lib/billing/plan-offer.ts). Rendered inside a Suspense boundary: the billing
 * service's figures never hold the home back. Without an offer, or on a failed read,
 * it shows `fallback`: the home's next step after it (util.next-step.ts).
 */
export async function PlanOfferSection({ fallback = null }: { fallback?: ReactNode }) {
  if (!isBillingEnabled()) return fallback;
  let offer;
  try {
    ({ offer } = await (await serverApi()).billing.getPlanOffer({}));
  } catch (error) {
    log.warn("billing", `plan offer card not shown: ${String(error)}`);
    return fallback;
  }
  if (!offer) return fallback;

  const locale = await getLocale();
  const money = (minor: number) => formatMinor(minor, offer.currency, locale);
  return (
    <>
      <HomeNextStepViewed step="planOffer" />
      <PlanOfferCard
        offer={offer}
        planName={offer.plan === "pro" ? "Pro" : "Ultra"}
        source={offer.source}
        period={offer.period}
        month={formatPeriod(offer.month, locale)}
        paid={money(offer.paidMinor)}
        price={money(offer.planPriceMinor)}
        priceWithVat={offer.vatRateBps > 0 ? money(offer.thresholdMinor) : null}
        vatRate={new Intl.NumberFormat(locale, {
          style: "percent",
          maximumFractionDigits: 2,
        }).format(offer.vatRateBps / 10_000)}
        savings={money(offer.savingsMinor)}
      />
    </>
  );
}
