"use client";

import { useTransition } from "react";

import { useRouter } from "next/navigation";

import { useFormatter, useTranslations } from "next-intl";

import { Badge, Button } from "@louez/ui";
import { GlobeIcon, PricingIcon, RewardIcon } from "@louez/ui/icons";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

import { OnboardingStepHeader } from "../_components/step-header";
import { useOnboardingErrorToast } from "../_lib/onboarding-error-toast";
import { acknowledgeReeentIntro } from "./actions";

interface ReeentClientPageProps {
  /** Launch-cohort seats still available, live from the marketplace channel. */
  remaining: number;
  total: number;
}

export function ReeentClientPage({ remaining, total }: ReeentClientPageProps) {
  const t = useTranslations("onboarding.reeent");
  const tCommon = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const showError = useOnboardingErrorToast();
  const [isPending, startTransition] = useTransition();

  const cohortIsOpen = remaining > 0;

  const handleContinue = () => {
    startTransition(async () => {
      try {
        const result = await acknowledgeReeentIntro();
        if ("error" in result) {
          throw new Error(result.error);
        }
        router.push("/onboarding/profile");
      } catch (error) {
        showError(error);
      }
    });
  };

  return (
    <>
      <OnboardingStepHeader title={t("title")} description={t("description")} />

      <div className="space-y-3">
        <section className="bg-muted/40 flex items-start gap-3 rounded-xl p-4">
          <DashboardIconTile icon={GlobeIcon} accent="primary" />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{t("products.title")}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">{t("products.body")}</p>
          </div>
        </section>

        <section className="bg-muted/40 flex items-start gap-3 rounded-xl p-4">
          <DashboardIconTile icon={RewardIcon} accent="success" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-medium">{t("offer.title")}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">
              {cohortIsOpen ? t("offer.body") : t("offer.closedBody")}
            </p>
            {cohortIsOpen && (
              <Badge variant="success">
                {t("offer.remaining", {
                  remaining: format.number(remaining),
                  total: format.number(total),
                })}
              </Badge>
            )}
          </div>
        </section>

        <section className="bg-muted/40 flex items-start gap-3 rounded-xl p-4">
          <DashboardIconTile icon={PricingIcon} />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium">{t("pricing.title")}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">{t("pricing.body")}</p>
          </div>
        </section>
      </div>

      <Button className="mt-6 w-full" disabled={isPending} onClick={handleContinue}>
        {tCommon("next")}
      </Button>
    </>
  );
}
