"use client";

import { useTranslations } from "next-intl";

import { useStoreHasPermission } from "@/contexts/store-context";
import type { PaymentsSetupState } from "@/lib/dashboard/util.payments-setup";

import { ReeentBannerAction } from "./reeent-banner-action";
import { ReeentBannerShell } from "./reeent-banner-shell";
import { useStartStripeOnboarding } from "./use-start-stripe-onboarding";
import { reeentBannerTags } from "./util.reeent-banner-tags";

interface ReeentPaymentsBannerProps {
  state: PaymentsSetupState;
  /** reeent's home, the wordmark's link; null when the instance has none. */
  reeentUrl: string | null;
}

/**
 * For a store that signed up from reeent: reeent lists it only once Stripe
 * charges. One sentence per moment, one action — none while Stripe checks the
 * identity, since there is nothing to do but wait. Not dismissible: it is
 * what keeps the store off reeent.
 */
export const ReeentPaymentsBanner = ({ state, reeentUrl }: ReeentPaymentsBannerProps) => {
  const canManage = useStoreHasPermission("manage_settings");
  const t = useTranslations("dashboard.home.reeentBanner");
  const { start, isPending } = useStartStripeOnboarding();
  const tags = reeentBannerTags(reeentUrl);

  if (state === "verifying") {
    return (
      <ReeentBannerShell
        badge="waiting"
        actions={
          <span className="text-muted-foreground px-2 text-xs font-semibold whitespace-nowrap">
            {t("verifying.idle")}
          </span>
        }
      >
        <span className="bg-badge-warning-background text-badge-warning-foreground relative -top-px me-2 inline-flex items-center gap-1.5 rounded-full py-1 ps-1.5 pe-2 text-[11px] leading-none font-extrabold">
          <span aria-hidden className="size-1.5 rounded-full bg-current" />
          {t("verifying.chip")}
        </span>
        {t.rich("verifying.text", tags)}
      </ReeentBannerShell>
    );
  }

  return (
    <ReeentBannerShell
      actions={
        canManage && (
          <ReeentBannerAction onClick={start} isPending={isPending}>
            {t(`${state}.action`)}
          </ReeentBannerAction>
        )
      }
    >
      {t.rich(`${state}.text`, tags)}
    </ReeentBannerShell>
  );
};
