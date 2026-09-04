"use client";

import { useRouter } from "next/navigation";

import { Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { OnboardingStepHeader } from "../_components/step-header";
import { useStripeConnectStart } from "../_lib/use-stripe-connect-start";
import { useStripeStep } from "./use-stripe-step";

/**
 * Stripe step for loueurs reeent sent over. The reeent publication checklist
 * requires operational Stripe charges, so a store in `request` mode never gets
 * published there — offering the choice would hand them a store that misses
 * the very marketplace they signed up for. The step keeps `payment` mode and
 * only asks when: now, or later from the dashboard.
 */
export const ReeentStripeClientPage = ({ nextPath }: { nextPath: string }) => {
  const router = useRouter();
  const t = useTranslations("onboarding.stripe");
  const tCommon = useTranslations("common");
  const { form, isPending } = useStripeStep({ nextPath });
  const { startStripeConnect, isConnecting, hasPendingAccount } = useStripeConnectStart({
    fromReeent: true,
  });

  return (
    <>
      <OnboardingStepHeader title={t("reeent.title")} description={t("reeent.description")} />
      <form.AppForm>
        <form.Form className="space-y-6">
          {/* The right panel expands on all of this, but it is hidden below lg:
              the reasoning has to survive on its own here. */}
          <section className="bg-muted/40 space-y-2 rounded-xl border p-4">
            <h2 className="text-sm font-medium">{t("reeent.whyTitle")}</h2>
            <p className="text-muted-foreground text-sm leading-relaxed">{t("reeent.why1")}</p>
            <p className="text-muted-foreground text-sm leading-relaxed">{t("reeent.why2")}</p>
          </section>

          <div className="flex gap-3">
            <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <p className="text-muted-foreground text-sm leading-relaxed">
              {t("reeent.withoutStripe")}
            </p>
          </div>

          {/* One action group: the primary row and its "later" escape hatch sit
              tight together, and "later" stays a ghost so the screen keeps a
              single primary CTA. */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                onClick={() => router.push("/onboarding/branding")}
                disabled={isPending || isConnecting}
              >
                {tCommon("back")}
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={startStripeConnect}
                isPending={isConnecting}
                disabled={isPending}
              >
                {t(hasPendingAccount ? "panel.payment.resumeNow" : "panel.payment.configureNow")}
              </Button>
            </div>
            <form.SubscribeButton variant="ghost" className="w-full" disabled={isConnecting}>
              {t("reeent.later")}
            </form.SubscribeButton>
            <p className="text-muted-foreground text-xs leading-relaxed">{t("reeent.laterNote")}</p>
          </div>
        </form.Form>
      </form.AppForm>
    </>
  );
};
