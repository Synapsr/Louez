"use client";

import type { ReactNode } from "react";

import Link from "next/link";

import { ArrowRight, Check, Clock, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { ProductSolidIcon } from "@louez/ui/icons";
import { ReservationsGlassIcon } from "@louez/ui/icons/glass";
import { cn } from "@louez/utils";

import { useStoreHasPermission } from "@/contexts/store-context";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import type {
  FirstDayPath as FirstDayPathData,
  FirstDayStepKey,
  FirstDayStepState,
} from "@/lib/dashboard/util.first-day-path";
import type { PaymentsSetupState } from "@/lib/dashboard/util.payments-setup";

import { HomeEmptyState } from "./home-empty-state";
import { ShareStoreActions } from "./share-store-actions";
import { useStartStripeOnboarding } from "./use-start-stripe-onboarding";

const PAYMENTS_SETTINGS_HREF = "/dashboard/settings/payments";

interface FirstDayPathProps {
  path: FirstDayPathData;
  storeSlug: string;
  storeName: string;
  /** A banner above already asks for something first: this button steps down. */
  hasPriorityAction: boolean;
  /** Where Stripe stands, for a store that chose online payment. */
  paymentsSetup: PaymentsSetupState | null;
  isFromReeent: boolean;
}

/**
 * The steps that lead a new store to its first request, in the card that will
 * hold them: a published product, how it gets paid, then sharing the store.
 *
 * Every step keeps a way to its page, whatever its state: the current one
 * leads with the main action, a step ahead can be started out of order, and a
 * step done can be revisited — a payment choice changed, products managed.
 * While Stripe checks the account, its step says so and the path moves on.
 */
export const FirstDayPath = ({
  path,
  storeSlug,
  storeName,
  hasPriorityAction,
  paymentsSetup,
  isFromReeent,
}: FirstDayPathProps) => {
  const t = useTranslations("dashboard.home");
  const tOnboarding = useTranslations("onboarding.stripe");
  const canManage = useStoreHasPermission("manage_settings");
  const stripe = useStartStripeOnboarding();
  const { getAbsoluteUrl } = useStorefrontUrl(storeSlug);
  const mainVariant = hasPriorityAction ? "outline" : "default";

  if (path.current === null) {
    return (
      <HomeEmptyState
        size="compact"
        illustration={{ main: ReservationsGlassIcon }}
        title={t("path.readyTitle")}
        description={t("path.readyText")}
        story="upToDate"
      />
    );
  }

  const stepTitle = (key: FirstDayStepKey, state: FirstDayStepState) =>
    key === "payments" && (state === "done" || path.paymentsMode === "request")
      ? t("path.steps.payments.modeTitle")
      : t(`path.steps.${key}.title`);

  const stepText = (key: FirstDayStepKey, state: FirstDayStepState) => {
    if (key !== "payments") return state === "done" ? null : t(`path.steps.${key}.text`);
    // The onboarding's own words for the mode the store chose.
    if (path.paymentsMode === "request") {
      return `${tOnboarding("requestMode")} — ${tOnboarding("requestModeDescription")}`;
    }
    if (state === "done") return `${tOnboarding("paymentMode")} — ${t("path.steps.payments.done")}`;
    if (state === "waiting") return t("path.steps.payments.verifyingText");
    // One line says where Stripe stands: no account yet, or the identity left to verify.
    if (paymentsSetup === "resume") return t("path.steps.payments.resumeText");
    if (isFromReeent) return t("setup.descriptions.connectStripeReeent");
    return tOnboarding("paymentModeDescription");
  };

  /**
   * Every step's action sits in the same place, under its text: the current
   * step's as small buttons, the others' as a plain link to their page.
   */
  const linkClassName =
    "text-primary inline-flex w-fit items-center gap-1 text-xs font-semibold hover:underline focus-visible:ring-ring rounded-sm focus-visible:ring-2 focus-visible:outline-none";

  const stepLink = (href: string, label: string, external = false) =>
    external ? (
      <a href={href} target="_blank" rel="noreferrer" className={linkClassName}>
        {label}
        <ExternalLink className="size-3" />
      </a>
    ) : (
      <Link href={href} className={linkClassName}>
        {label}
        <ArrowRight className="size-3" />
      </Link>
    );

  const stripeLabel =
    paymentsSetup === "resume"
      ? tOnboarding("panel.payment.resumeNow")
      : t("path.steps.payments.start");

  const stepAction = (key: FirstDayStepKey, state: FirstDayStepState): ReactNode => {
    if (key === "product") {
      if (state === "current") {
        return (
          <Button size="sm" variant={mainVariant} render={<Link href="/dashboard/products/new" />}>
            <ProductSolidIcon />
            {t("header.cta.addFirstProduct")}
          </Button>
        );
      }
      return state === "done"
        ? stepLink("/dashboard/products", t("path.steps.product.manage"))
        : stepLink("/dashboard/products/new", t("setup.addFirstProduct"));
    }

    if (key === "payments") {
      if (!canManage) return null;
      if (path.paymentsMode === "request") {
        return stepLink(PAYMENTS_SETTINGS_HREF, t("path.steps.payments.switchToOnline"));
      }
      if (state === "current") {
        return (
          <Button
            size="sm"
            variant={mainVariant}
            onClick={stripe.start}
            isPending={stripe.isPending}
          >
            {stripeLabel}
          </Button>
        );
      }
      if (state === "upcoming") {
        return (
          <button
            type="button"
            onClick={stripe.start}
            disabled={stripe.isPending}
            className={cn(linkClassName, "disabled:opacity-60")}
          >
            {stripeLabel}
            <ArrowRight className="size-3" />
          </button>
        );
      }
      // Done, or Stripe checking: the settings page shows where it stands.
      return stepLink(PAYMENTS_SETTINGS_HREF, t("reeentStripe.paymentSettings"));
    }

    if (state === "current") {
      return <ShareStoreActions storeSlug={storeSlug} storeName={storeName} />;
    }
    return stepLink(getAbsoluteUrl(), t("setup.viewStore"), true);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-bold">{t("path.title")}</p>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {path.completedCount}/{path.steps.length}
        </span>
      </div>
      {/* Drawn like the onboarding's steps: dots joined by a line, no boxes. */}
      <ol>
        {path.steps.map((step, index) => {
          const done = step.state === "done";
          const current = step.state === "current";
          const waiting = step.state === "waiting";
          const text = stepText(step.key, step.state);
          const action = stepAction(step.key, step.state);
          return (
            <li
              key={step.key}
              aria-current={current ? "step" : undefined}
              className="relative flex gap-3 pb-5 last:pb-0"
            >
              {index < path.steps.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute start-2.5 top-7 bottom-1 w-0.5 rounded-full",
                    done ? "bg-success/40" : "bg-border",
                  )}
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "flex size-5.5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-bold",
                  done && "bg-success text-white",
                  current && "bg-primary text-primary-foreground",
                  // Waiting on Stripe, not on the owner: amber, apart from the blue of "to do".
                  waiting && "bg-badge-warning-background text-badge-warning-foreground",
                  step.state === "upcoming" && "bg-accent text-primary/70",
                )}
              >
                {done ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : waiting ? (
                  <Clock className="size-3" strokeWidth={2.5} />
                ) : (
                  index + 1
                )}
              </span>
              <div className="flex min-w-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p
                    className={cn(
                      "flex flex-wrap items-center gap-2 text-sm font-semibold",
                      done && "text-muted-foreground",
                    )}
                  >
                    {stepTitle(step.key, step.state)}
                    {waiting && (
                      <span className="bg-badge-warning-background text-badge-warning-foreground rounded-full px-2 py-0.5 text-[11px] font-bold">
                        {t("path.steps.payments.verifyingBadge")}
                      </span>
                    )}
                  </p>
                  {text && <p className="text-muted-foreground text-xs text-pretty">{text}</p>}
                  {action && <div className="mt-1.5 flex flex-wrap gap-2">{action}</div>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
