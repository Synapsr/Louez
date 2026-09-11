"use client";

import {
  BanknoteIcon,
  CircleAlertIcon,
  CreditCardIcon,
  ShieldCheckIcon,
  ShieldIcon,
  ShieldOffIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { cn } from "@louez/utils";

import { AccountCard } from "@/components/storefront/account/account-card";
import { AuthorizeDepositButton } from "@/components/storefront/account/authorize-deposit-button";
import { Price } from "@/components/storefront/ui/price";
import { useFormatMoney } from "@/hooks/use-format-money";

/** Dates already formatted in the store timezone. */
export type ReservationDepositView =
  | { kind: "to_provide"; amount: number; online: boolean }
  | { kind: "card_saved"; amount: number }
  | { kind: "held"; amount: number; expiresLabel: string | null }
  | { kind: "hold_expired"; amount: number }
  | { kind: "released"; amount: number }
  | {
      kind: "captured";
      amount: number;
      capturedAmount: number;
      releasedAmount: number;
      reason: string | null;
      capturedLabel: string | null;
    }
  | { kind: "failed"; amount: number }
  | { kind: "collected"; amount: number; method: string; receivedLabel: string | null }
  | {
      kind: "returned";
      amount: number;
      returnedAmount: number;
      method: string;
      returnedLabel: string | null;
      partial: boolean;
    };

interface ReservationDepositCardProps {
  deposit: ReservationDepositView;
  /** Set when the customer can place the card hold now. */
  authorize: { storeSlug: string; reservationId: string } | null;
}

type Tone = "neutral" | "info" | "success" | "warning" | "failed";

const TONE: Record<ReservationDepositView["kind"], Tone> = {
  to_provide: "neutral",
  card_saved: "info",
  held: "success",
  hold_expired: "warning",
  released: "success",
  captured: "warning",
  failed: "failed",
  collected: "info",
  returned: "success",
};

const BADGE_VARIANT: Record<Tone, "tertiary" | "info" | "success" | "warning" | "failed"> = {
  neutral: "tertiary",
  info: "info",
  success: "success",
  warning: "warning",
  failed: "failed",
};

const DISC_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  failed: "bg-destructive/12 text-destructive",
};

const ICON: Record<ReservationDepositView["kind"], typeof ShieldIcon> = {
  to_provide: ShieldIcon,
  card_saved: CreditCardIcon,
  held: ShieldCheckIcon,
  hold_expired: CircleAlertIcon,
  released: ShieldCheckIcon,
  captured: ShieldOffIcon,
  failed: CircleAlertIcon,
  collected: BanknoteIcon,
  returned: ShieldCheckIcon,
};

/**
 * Where the deposit stands, in the customer's words: what is blocked, taken
 * or given back, when, and why. The card hold can be placed from here once
 * pickup is close enough for the hold to still be live.
 */
export const ReservationDepositCard = ({ deposit, authorize }: ReservationDepositCardProps) => {
  const t = useTranslations("storefront.account.depositCard");
  const tMethods = useTranslations("storefront.account.paymentHistory.methods");
  const formatMoney = useFormatMoney();

  const tone = TONE[deposit.kind];
  const Icon = ICON[deposit.kind];
  const amount = formatMoney(deposit.amount);

  const stateKey =
    deposit.kind === "to_provide" && deposit.online
      ? "to_provide_online"
      : deposit.kind === "returned" && deposit.partial
        ? "partially_returned"
        : deposit.kind;

  const description = (() => {
    switch (deposit.kind) {
      case "captured":
        return t(`states.${stateKey}.description`, {
          amount,
          captured: formatMoney(deposit.capturedAmount),
        });
      case "collected":
        return t(`states.${stateKey}.description`, {
          amount,
          method: tMethods(deposit.method),
          date: deposit.receivedLabel ?? "",
        });
      case "returned":
        return t(`states.${stateKey}.description`, {
          amount,
          returned: formatMoney(deposit.returnedAmount),
          date: deposit.returnedLabel ?? "",
        });
      default:
        return t(`states.${stateKey}.description`, { amount });
    }
  })();

  const detail =
    deposit.kind === "held" && deposit.expiresLabel
      ? t("heldUntil", { date: deposit.expiresLabel })
      : deposit.kind === "captured" && deposit.releasedAmount > 0
        ? t("restReleased", { amount: formatMoney(deposit.releasedAmount) })
        : null;

  return (
    <AccountCard
      title={t("title")}
      aside={
        <Badge variant={BADGE_VARIANT[tone]} size="sm">
          {t(`states.${stateKey}.badge`)}
        </Badge>
      }
    >
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full [&_svg]:size-5",
            DISC_CLASS[tone],
          )}
        >
          <Icon />
        </div>
        <div className="min-w-0 flex flex-col gap-1">
          <p className="font-medium leading-snug">{t(`states.${stateKey}.title`)}</p>
          <p className="text-pretty text-sm text-muted-foreground">{description}</p>
          {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
        </div>
      </div>

      <dl className="flex flex-col gap-2 border-t pt-4 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-muted-foreground">{t("amount")}</dt>
          <dd>
            <Price amount={deposit.amount} size="sm" />
          </dd>
        </div>
        {deposit.kind === "captured" ? (
          <div className="flex justify-between gap-4 text-destructive">
            <dt>
              {t("capturedAmount")}
              {deposit.capturedLabel ? (
                <span className="text-muted-foreground">
                  <span aria-hidden> · </span>
                  {deposit.capturedLabel}
                </span>
              ) : null}
            </dt>
            <dd>
              <Price amount={-deposit.capturedAmount} size="sm" className="text-destructive" />
            </dd>
          </div>
        ) : null}
        {deposit.kind === "returned" ? (
          <div className="flex justify-between gap-4 text-success">
            <dt>{t("returnedAmount")}</dt>
            <dd>
              <Price amount={deposit.returnedAmount} size="sm" className="text-success" />
            </dd>
          </div>
        ) : null}
      </dl>

      {deposit.kind === "captured" && deposit.reason ? (
        <div className="rounded-lg bg-muted p-3">
          <p className="text-xs font-medium text-muted-foreground">{t("reason")}</p>
          <p className="mt-1 whitespace-pre-line text-sm">{deposit.reason}</p>
        </div>
      ) : null}

      {authorize ? (
        <AuthorizeDepositButton
          storeSlug={authorize.storeSlug}
          reservationId={authorize.reservationId}
        />
      ) : null}
    </AccountCard>
  );
};
