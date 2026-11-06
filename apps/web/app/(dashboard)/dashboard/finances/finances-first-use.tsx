"use client";

import Link from "next/link";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { WalletIcon } from "@louez/ui/icons";

interface FinancesFirstUseProps {
  /** Without Stripe, online payments cannot reach the ledger: say where to connect it. */
  stripeConnected: boolean;
}

/** Shown until the store records its first payment, in place of an empty dashboard. */
export const FinancesFirstUse = ({ stripeConnected }: FinancesFirstUseProps) => {
  const t = useTranslations("dashboard.finances.firstUse");

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-16 text-center">
      <div className="bg-muted mb-4 flex size-16 items-center justify-center rounded-full">
        <WalletIcon className="text-muted-foreground size-8" />
      </div>
      <h2 className="text-lg font-semibold">{t("title")}</h2>
      <p className="text-muted-foreground mt-2 max-w-md text-sm text-balance">{t("description")}</p>
      <Button render={<Link href="/dashboard/reservations/new" />} className="mt-6">
        {t("cta")}
      </Button>
      {!stripeConnected && (
        <p className="text-muted-foreground mt-4 text-xs">
          {t("stripeHint")}{" "}
          <Link
            href="/dashboard/settings/payments"
            className="text-foreground underline underline-offset-2"
          >
            {t("stripeLink")}
          </Link>
          .
        </p>
      )}
    </div>
  );
};
