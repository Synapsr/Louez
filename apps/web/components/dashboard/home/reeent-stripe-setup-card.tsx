"use client";

import { useStoreHasPermission } from "@/contexts/store-context";

import { useState } from "react";
import Link from "next/link";

import { useTranslations } from "next-intl";

import { Button, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import { startStripeOnboarding } from "@/app/(dashboard)/dashboard/settings/payments/actions";
import { ReeentMark } from "@/components/shared/reeent-mark";
import { reeentRichTags } from "@/components/shared/reeent-wordmark";

interface ReeentStripeSetupCardProps {
  /** A Stripe account already exists, so the KYC is resumed rather than started. */
  hasStripeAccount: boolean;
  className?: string;
}

/**
 * Home card for loueurs who came from reeent and left the Stripe step for
 * later. The reeent publication checklist requires operational charges, so
 * their store stays unlisted there — a fact nothing on the dashboard used to
 * state. The card carries the launch offer too, so the generic "seats left"
 * incentive line can stay off the home for these stores.
 *
 * A plain container rather than a link: the Stripe KYC starts from a server
 * action, so the button owns the action and the card stays inert.
 *
 * Dressed in reeent's identity (mark, wordmark, a wash of its orange) rather
 * than the dashboard's warning tone: this is the partner talking, not an
 * alert, and it should sit quietly with the rest of the home.
 */
export const ReeentStripeSetupCard = ({
  hasStripeAccount,
  className,
}: ReeentStripeSetupCardProps) => {
  const canManage = useStoreHasPermission("manage_settings");
  const t = useTranslations("dashboard.home");
  const tErrors = useTranslations("errors");

  const [isConnecting, setIsConnecting] = useState(false);

  const handleConnect = async () => {
    setIsConnecting(true);
    try {
      const result = await startStripeOnboarding();
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace("errors.", "")), type: "error" });
      } else if (result.url) {
        window.location.href = result.url;
      }
    } catch {
      toastManager.add({ title: tErrors("generic"), type: "error" });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div
      className={cn(
        "from-reeent/9 to-card ring-reeent/22 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-3 rounded-2xl bg-linear-to-r to-65% p-4 ring-1 ring-inset sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:p-5",
        className,
      )}
    >
      <ReeentMark className="shadow-reeent/40 size-11 self-start rounded-xl shadow-[0_10px_24px_-12px]" />
      <div className="min-w-0 space-y-1.5">
        <span className="bg-reeent/12 text-reeent inline-flex items-center gap-1.5 rounded-full py-0.5 ps-1.5 pe-2.5 text-[11px] font-bold">
          <span aria-hidden className="bg-reeent size-1.5 rounded-full" />
          {t("reeentStripe.status")}
        </span>
        <p className="font-semibold tracking-tight">{t.rich("reeentStripe.title", reeentRichTags)}</p>
        <p className="text-muted-foreground max-w-[70ch] text-sm">{t("reeentStripe.description")}</p>
      </div>
      <div className="col-span-full flex flex-wrap items-center gap-2 sm:col-span-1 sm:flex-col sm:items-end">
        {canManage && (
          <Button onClick={handleConnect} isPending={isConnecting}>
            {t(hasStripeAccount ? "reeentStripe.continueSetup" : "reeentStripe.activate")}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          render={<Link href="/dashboard/settings/payments" />}
        >
          {t("reeentStripe.paymentSettings")}
        </Button>
      </div>
    </div>
  );
};
