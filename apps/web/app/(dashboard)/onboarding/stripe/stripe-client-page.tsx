"use client";

import { useRouter } from "next/navigation";

import { Check, CreditCard, Inbox, Info } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { Radio, RadioGroup } from "@louez/ui";
import { Label } from "@louez/ui";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

import { OnboardingStepHeader } from "../_components/step-header";
import { useStripeConnectStart } from "../_lib/use-stripe-connect-start";
import { useStripeStep } from "./use-stripe-step";

/** The selected mode card is lifted and ticked, so the choice reads at a glance. */
const MODE_CARD_CLASS =
  "group/mode bg-card hover:bg-muted/50 relative flex cursor-pointer items-start gap-3 rounded-xl p-4 pe-11 shadow-[inset_0_0_0_1px_var(--color-border)] transition-[background-color,box-shadow] duration-200 has-data-checked:bg-card has-data-checked:shadow-[inset_0_0_0_1.5px_var(--color-primary),var(--shadow-raised)]";
const MODE_TICK_CLASS =
  "bg-primary text-primary-foreground ease-lagon absolute top-4 right-4 flex size-5 scale-0 items-center justify-center rounded-full transition-transform duration-200 group-has-data-checked/mode:scale-100";

export function OnboardingStripeClientPage() {
  const router = useRouter();
  const t = useTranslations("onboarding.stripe");
  const tCommon = useTranslations("common");
  const { form, reservationMode, isPending, isNavigating } = useStripeStep();
  const { startStripeConnect, isConnecting, hasPendingAccount } = useStripeConnectStart({
    fromReeent: false,
  });
  const isLeaving = isPending || isConnecting;

  return (
    <>
      <OnboardingStepHeader title={t("title")} description={t("description")} />
      <form.AppForm>
        <form.Form className="space-y-6">
          {/* Reservation Mode */}
          <form.Field name="reservationMode">
            {(field) => (
              <div className="space-y-2">
                <RadioGroup
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as "request" | "payment")}
                >
                  <Label className={MODE_CARD_CLASS}>
                    <Radio value="payment" className="hidden" />
                    <span className={MODE_TICK_CLASS}>
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <DashboardIconTile icon={CreditCard} />
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{t("paymentMode")}</p>
                        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs font-medium">
                          {t("recommended")}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-sm">{t("paymentModeDescription")}</p>
                    </div>
                  </Label>
                  <Label className={MODE_CARD_CLASS}>
                    <Radio value="request" className="hidden" />
                    <span className={MODE_TICK_CLASS}>
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <DashboardIconTile icon={Inbox} />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t("requestMode")}</p>
                      <p className="text-muted-foreground text-sm">{t("requestModeDescription")}</p>
                    </div>
                  </Label>
                </RadioGroup>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm">{field.state.meta.errors.join(", ")}</p>
                )}
              </div>
            )}
          </form.Field>

          {/* Compact mode note — the full explainer lives in the right panel,
              which is hidden below lg */}
          <div className="bg-muted/40 rounded-xl border p-4 lg:hidden">
            <div className="flex gap-3">
              <Info className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <p className="text-muted-foreground text-sm">
                {reservationMode === "payment" ? t("paymentModeNote") : t("requestModeNote")}
              </p>
            </div>
          </div>

          {/* One row of actions, worded after the chosen mode: online payment
              offers Stripe now or later, request mode simply goes on. */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push("/onboarding/branding")}
              disabled={isLeaving}
            >
              {tCommon("back")}
            </Button>
            {reservationMode === "payment" ? (
              <>
                <form.SubscribeButton
                  variant="outline"
                  disabled={isConnecting}
                  isPending={isNavigating}
                >
                  {t("reeent.later")}
                </form.SubscribeButton>
                <Button
                  type="button"
                  className="flex-1"
                  onClick={startStripeConnect}
                  disabled={isPending}
                  isPending={isConnecting}
                >
                  {t(hasPendingAccount ? "panel.payment.resumeNow" : "panel.payment.configureNow")}
                </Button>
              </>
            ) : (
              <form.SubscribeButton className="flex-1" isPending={isNavigating}>
                {tCommon("next")}
              </form.SubscribeButton>
            )}
          </div>
        </form.Form>
      </form.AppForm>
    </>
  );
}
