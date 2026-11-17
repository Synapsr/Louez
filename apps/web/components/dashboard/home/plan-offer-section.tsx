import { getLocale } from "next-intl/server";

import { serverApi } from "@/lib/api/server-api";
import { formatMinor, formatPeriod } from "@/lib/billing/billing-format";
import { isBillingEnabled } from "@/lib/billing/mode";
import { log } from "@/lib/evlog";

import { PlanOfferCard } from "./plan-offer-card";

/**
 * The home's offer of a plan that would have cost the store less than what it paid
 * Louez (lib/billing/plan-offer.ts). Rendered inside a Suspense boundary: the billing
 * service's figures never hold the home back, and a failed read shows nothing.
 */
export async function PlanOfferSection() {
  if (!isBillingEnabled()) return null;
  let offer;
  try {
    ({ offer } = await (await serverApi()).billing.getPlanOffer({}));
  } catch (error) {
    log.warn("billing", `plan offer card not shown: ${String(error)}`);
    return null;
  }
  if (!offer) return null;

  const locale = await getLocale();
  const money = (minor: number) => formatMinor(minor, offer.currency, locale);
  return (
    <PlanOfferCard
      offer={offer}
      planName={offer.plan === "pro" ? "Pro" : "Ultra"}
      source={offer.source}
      period={offer.period}
      month={formatPeriod(offer.month, locale)}
      paid={money(offer.paidMinor)}
      price={money(offer.planPriceMinor)}
      priceWithVat={offer.vatRateBps > 0 ? money(offer.thresholdMinor) : null}
      vatRate={new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(
        offer.vatRateBps / 10_000,
      )}
      savings={money(offer.savingsMinor)}
    />
  );
}
