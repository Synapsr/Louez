"use client";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { CreditCardIcon, ShieldCheckIcon } from "@louez/ui/icons";

import { useCardSetup } from "@/app/(dashboard)/dashboard/settings/billing/use-card-setup";

import { OnboardingStepHeader } from "../_components/step-header";
import { useBillingCardStep } from "./use-billing-card-step";

/**
 * The card itself is entered on Stripe Checkout, which comes back here. Generic words
 * only (louez-billing docs/plans/design.md §6.4).
 */
export const BillingCardClientPage = () => {
  const t = useTranslations("onboarding.billingCard");
  const { handleLater } = useBillingCardStep();
  const card = useCardSetup("onboarding");

  return (
    <>
      <OnboardingStepHeader title={t("title")} description={t("description")} />
      <div className="space-y-6">
        <div className="bg-muted/40 rounded-xl border p-4">
          <div className="flex gap-3">
            <ShieldCheckIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <p className="text-muted-foreground text-sm leading-relaxed">{t("secureNote")}</p>
          </div>
        </div>

        {/* One action group, as on the payment step: the card is the single primary
            action, "later" stays a ghost right under it. */}
        <div className="space-y-2 pt-2">
          <Button className="w-full" onClick={card.start} isPending={card.opening}>
            <CreditCardIcon className="size-4" />
            {t("addCard")}
          </Button>
          {card.failed && (
            <p className="text-destructive text-sm" role="alert">
              {t("startFailed")}
            </p>
          )}
          <Button type="button" variant="ghost" className="w-full" onClick={handleLater}>
            {t("later")}
          </Button>
          <p className="text-muted-foreground text-xs leading-relaxed">{t("laterNote")}</p>
        </div>
      </div>
    </>
  );
};
