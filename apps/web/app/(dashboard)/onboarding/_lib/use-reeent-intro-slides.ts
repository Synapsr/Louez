"use client";

import type { ComponentType } from "react";

import { useFormatter, useTranslations } from "next-intl";

import { GlobeIcon, PricingIcon, RewardIcon } from "@louez/ui/icons";

import type { DashboardAccent } from "@/components/dashboard/shared/dashboard-accent";
import { useInstanceConfig } from "@/components/instance-provider";

import { useReeentIntro } from "./reeent-intro-context";

export interface ReeentIntroSlide {
  key: string;
  icon: ComponentType<{ className?: string }>;
  accent: DashboardAccent;
  title: string;
  /** Prose slides carry a paragraph; the pricing slide leads with its figure. */
  body?: string;
  amount?: { value: string; unit?: string; detail?: string };
  bullets?: string[];
  /** Only the offer carries one: the live seat count. */
  badge?: string;
  /** Only shown to individuals: what renting out means for their taxes. */
  note?: string;
}

/**
 * The explanations the step walks through, in order. Both columns read them:
 * the step renders one at a time, the panel lists their titles as progress.
 * The launch offer and the pricing are Louez Cloud's: an instance that does not
 * bill its stores only explains the two products.
 */
export const useReeentIntroSlides = (): ReeentIntroSlide[] => {
  const t = useTranslations("onboarding.reeent.panel");
  const format = useFormatter();
  const { cohort, pricing, status } = useReeentIntro();
  const { billingEnabled } = useInstanceConfig();

  const isIndividual = status === "individual";
  const cohortIsOpen = cohort.remaining > 0;

  const products: ReeentIntroSlide = {
    key: "products",
    icon: GlobeIcon,
    accent: "primary",
    title: t("products.title"),
    body: isIndividual ? t("products.individualBody") : t("products.body"),
  };
  if (!billingEnabled) return [products];

  return [
    products,
    {
      key: "offer",
      icon: RewardIcon,
      accent: "success",
      title: t("offer.title"),
      body: cohortIsOpen
        ? t("offer.body", { total: format.number(cohort.total) })
        : t("offer.closedBody"),
      badge: cohortIsOpen
        ? t("offer.remaining", {
            remaining: format.number(cohort.remaining),
            total: format.number(cohort.total),
          })
        : undefined,
    },
    pricing.kind === "legacy"
      ? {
          // Louez's own billing bills per booking by default, and a monthly
          // subscription exists for people who rent a lot. The slide names both:
          // saying "no subscription" would be plainly wrong.
          key: "pricing",
          icon: PricingIcon,
          accent: "neutral",
          title: t("pricing.title"),
          amount: {
            value: t("pricing.amount"),
            unit: t("pricing.amountUnit"),
            detail: t("pricing.amountDetail"),
          },
          bullets: [t("pricing.quietMonth"), t("pricing.subscription"), t("pricing.switch")],
          note: isIndividual ? t("pricing.individualNote") : undefined,
        }
      : {
          // The billing service's offer: its label is the figure, and Louez's words
          // around it name no rate and no price.
          key: "pricing",
          icon: PricingIcon,
          accent: "neutral",
          title: t("pricing.title"),
          amount: pricing.offer ? { value: pricing.offer } : undefined,
          body: t("pricing.details"),
          note: isIndividual ? t("pricing.individualNote") : undefined,
        },
  ];
};
