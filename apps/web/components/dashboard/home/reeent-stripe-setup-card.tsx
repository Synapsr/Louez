"use client";

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
        "bg-reeent/6 ring-reeent/20 flex flex-col gap-3 rounded-2xl p-4 ring-1 ring-inset sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <ReeentMark className="size-9 rounded-lg" />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">{t.rich("reeentStripe.title", reeentRichTags)}</p>
          <p className="text-muted-foreground text-sm">{t("reeentStripe.description")}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 max-sm:justify-end">
        <Button
          variant="ghost"
          className="text-muted-foreground"
          render={<Link href="/dashboard/settings/payments" />}
        >
          {t("reeentStripe.paymentSettings")}
        </Button>
        <Button onClick={handleConnect} isPending={isConnecting}>
          {t(hasStripeAccount ? "reeentStripe.continueSetup" : "reeentStripe.activate")}
        </Button>
      </div>
    </div>
  );
};
