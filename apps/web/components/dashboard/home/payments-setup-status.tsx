"use client";

import Link from "next/link";

import { ArrowRight, Clock, CreditCard } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { useStoreHasPermission } from "@/contexts/store-context";
import type { PaymentsSetupState } from "@/lib/dashboard/util.payments-setup";

import { useStartStripeOnboarding } from "./use-start-stripe-onboarding";

/**
 * A banner at the top of the requests card, for a store that chose online
 * payment at onboarding and whose Stripe does not charge yet, once its first
 * day is behind it (the first-day path says it before). It explains why
 * bookings still arrive as requests, and what is left — if anything — to
 * switch to online payment. Tinted by who is waiting on whom: amber while
 * Stripe checks, blue while something is left to do.
 */
export const PaymentsSetupStatus = ({ state }: { state: PaymentsSetupState }) => {
  const canManage = useStoreHasPermission("manage_settings");
  const t = useTranslations("dashboard.home.paymentsStatus");
  const tSteps = useTranslations("dashboard.home.path.steps.payments");
  const tOnboarding = useTranslations("onboarding.stripe.panel.payment");
  const tHome = useTranslations("dashboard.home");
  const { start, isPending } = useStartStripeOnboarding();
  const verifying = state === "verifying";

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-3",
        verifying ? "bg-badge-warning-background/60" : "bg-accent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          verifying
            ? "bg-badge-warning-background text-badge-warning-foreground"
            : "bg-card text-primary",
        )}
      >
        {verifying ? <Clock className="size-4" /> : <CreditCard className="size-4" />}
      </span>
      <div className="min-w-48 flex-1">
        <p className="text-sm font-semibold">{t(`${state}Title`)}</p>
        <p className="text-muted-foreground text-xs text-pretty">
          {state === "resume" ? tSteps("resumeText") : t("meanwhile")}
        </p>
      </div>
      {canManage &&
        (verifying ? (
          <Button
            size="sm"
            variant="ghost"
            // The banner's own amber, not the dashboard's blue: one hue per banner.
            className="text-badge-warning-foreground hover:text-badge-warning-foreground hover:bg-badge-warning-background shrink-0"
            render={<Link href="/dashboard/settings/payments" />}
          >
            {tHome("reeentStripe.paymentSettings")}
            <ArrowRight />
          </Button>
        ) : (
          <Button size="sm" className="shrink-0" onClick={start} isPending={isPending}>
            {state === "resume" ? tOnboarding("resumeNow") : tSteps("start")}
          </Button>
        ))}
    </div>
  );
};
