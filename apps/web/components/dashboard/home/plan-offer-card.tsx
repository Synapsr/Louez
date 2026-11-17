"use client";

import { useEffect, useRef } from "react";

import { useMutation } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Collapsible, CollapsiblePanel, CollapsibleTrigger, toastManager } from "@louez/ui";

import type { PlanOfferView } from "@louez/api/contracts/billing";

import { readAffiliateReferral } from "@/lib/acquisition/klibon-browser";
import { apiErrorKey } from "@/lib/orpc/errors";
import { billingMutations } from "@/lib/queries/billing.queries";

export interface PlanOfferCardProps {
  /** The offer as the API gave it: counted as seen with these figures. */
  offer: PlanOfferView;
  planName: string;
  source: "legacy" | "service";
  period: "current" | "previous";
  /** The month the figures are about, written out ("Novembre 2026"). */
  month: string;
  /** What the store paid Louez that month, VAT included, formatted. */
  paid: string;
  /** The plan's monthly price excluding VAT, formatted. */
  price: string;
  /** The same with the VAT of the store's country; null where Louez charges none. */
  priceWithVat: string | null;
  /** That VAT rate, formatted ("20 %"). */
  vatRate: string;
  savings: string;
}

/**
 * The plan offer on the home: what the store paid, what the plan would have cost, a
 * button to Stripe's Checkout, and the calculation behind a disclosure. Closing it
 * hides it 30 days for the whole store; it stays until the close is saved.
 */
export const PlanOfferCard = ({
  offer,
  planName,
  source,
  period,
  month,
  paid,
  price,
  priceWithVat,
  vatRate,
  savings,
}: PlanOfferCardProps) => {
  const t = useTranslations("dashboard.home.planOffer");
  const tErrors = useTranslations("errors");
  const showError = (error: unknown) => {
    const key = apiErrorKey(error);
    toastManager.add({
      title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
      type: "error",
    });
  };
  const dismissal = useMutation({ ...billingMutations.dismissPlanOffer(), onError: showError });
  const checkout = useMutation({
    ...billingMutations.startPlanOffer(),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: showError,
  });
  // Counted as seen once half of it is on screen, once per visit of the home.
  const { mutate: markShown } = useMutation(billingMutations.recordPlanOfferShown());
  const cardRef = useRef<HTMLDivElement>(null);
  const counted = useRef(false);
  useEffect(() => {
    const node = cardRef.current;
    if (!node || counted.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (counted.current || !entries.some((entry) => entry.isIntersecting)) return;
        counted.current = true;
        observer.disconnect();
        markShown({ offer });
      },
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [offer, markShown]);

  if (dismissal.isSuccess) return null;

  const titleKey =
    source === "service"
      ? period === "current"
        ? "titleCurrentCommission"
        : "titlePreviousCommission"
      : period === "current"
        ? "titleCurrentFees"
        : "titlePreviousFees";

  return (
    <div ref={cardRef} className="bg-muted/40 ring-border rounded-xl p-4 ring-1 ring-inset">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">{t(titleKey, { paid })}</p>
          <p className="text-muted-foreground text-sm">
            {priceWithVat
              ? t("comparisonWithVat", { plan: planName, price, priceWithVat })
              : t("comparison", { plan: planName, price })}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => dismissal.mutate({})}
          disabled={dismissal.isPending}
          aria-label={t("dismiss")}
          title={t("dismiss")}
          className="text-muted-foreground -my-1 shrink-0"
        >
          <X />
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          size="sm"
          onClick={() => checkout.mutate({ affiliateReferral: readAffiliateReferral() })}
          isPending={checkout.isPending || checkout.isSuccess}
        >
          {t("cta", { plan: planName })}
        </Button>
        <span className="text-muted-foreground text-xs">{t("noCommitment")}</span>
      </div>

      <Collapsible className="mt-3">
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs">
          {t("detailsToggle")}
          <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <dl className="mt-3 space-y-3 text-sm sm:space-y-2">
            {[
              { term: t("detailsMonth"), value: month },
              {
                term: source === "service" ? t("detailsPaidCommission") : t("detailsPaidFees"),
                value: paid,
              },
              {
                term: t("detailsPlan", { plan: planName }),
                value: priceWithVat
                  ? t("detailsPlanPriceWithVat", { price, priceWithVat, vatRate })
                  : t("detailsPlanPrice", { price }),
              },
              { term: t("detailsSavings"), value: savings, strong: true },
            ].map(({ term, value, strong }) => (
              <div key={term} className="sm:grid sm:grid-cols-[12rem_1fr] sm:gap-6">
                <dt className="text-muted-foreground">{term}</dt>
                <dd className={strong ? "font-medium" : undefined}>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-muted-foreground mt-3 text-xs">{t("detailsNote")}</p>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
};
