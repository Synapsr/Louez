"use client";

import { History, Undo2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import { Badge, Skeleton } from "@louez/ui";
import { ShieldIcon } from "@louez/ui/icons";
import type { FinanceDepositsOutput } from "@louez/validations";

import { DashboardEmptyState } from "@/components/dashboard/shared/dashboard-empty-state";
import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { DashboardListRow } from "@/components/dashboard/shared/dashboard-list-row";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { useStore } from "@/contexts/store-context";
import { useFormatMoney } from "@/hooks/use-format-money";
import { formatStoreDate } from "@/lib/utils/store-date";

import { FinancesMovementAmount } from "./finances-movement-amount";
import { getHoldExpiry, type HoldExpiry } from "./util.finances";

interface FinancesDepositsTabProps {
  data: FinanceDepositsOutput | undefined;
  isError: boolean;
  /** Frozen at render on the server and the client alike, so expiries never flicker on hydration. */
  now: Date;
}

const EVENT_LABEL_KEYS = {
  cashed: "eventCashed",
  captured: "eventCaptured",
  returned: "eventReturned",
  released: "eventReleased",
} as const;

/** Cash sign of a history row: a released hold never moved money. */
const EVENT_SIGN = { cashed: 1, captured: 1, returned: -1, released: 0 } as const;

/** What the store holds for its customers: holds about to lapse first, then cash to give back. */
export const FinancesDepositsTab = ({ data, isError, now }: FinancesDepositsTabProps) => {
  const t = useTranslations("dashboard.finances");
  const locale = useLocale();
  const { timezone } = useStore();
  const formatMoney = useFormatMoney();

  const describeExpiry = (expiry: HoldExpiry, expiresAt: Date | null) => {
    if (expiry.kind === "expired") return t("deposits.expired");
    if (expiry.kind === "soon") return t("deposits.expiresIn", { count: expiry.days });
    return expiresAt
      ? t("deposits.expiresOn", {
          date: formatStoreDate(expiresAt, timezone, "SHORT_DATE", locale),
        })
      : t("deposits.noExpiry");
  };

  if (isError) return <p className="text-muted-foreground text-sm">{t("loadError")}</p>;

  if (!data) {
    return (
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-56 w-full rounded-2xl" />
        <Skeleton className="h-56 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <DashboardSectionCard
          title={t("deposits.holdsTitle")}
          description={t("deposits.holdsDescription")}
          icon={ShieldIcon}
          accent="progress"
          action={
            data.holds.length > 0 && (
              <Badge variant="outline">
                {t("deposits.holdsTotal", { amount: formatMoney(data.holdsTotal) })}
              </Badge>
            )
          }
        >
          {data.holds.length === 0 ? (
            <DashboardEmptyState icon={ShieldIcon} description={t("deposits.holdsEmpty")} />
          ) : (
            <div className="-mx-2 sm:-mx-3">
              {data.holds.map((hold) => {
                const expiry = getHoldExpiry(hold.expiresAt, now);
                const isUrgent = expiry.kind === "soon" || expiry.kind === "expired";
                return (
                  <DashboardListRow
                    key={hold.paymentId}
                    href={`/dashboard/reservations/${hold.reservationId}`}
                    leading={
                      <DashboardIconTile
                        icon={ShieldIcon}
                        accent={isUrgent ? "pending" : "progress"}
                        size="sm"
                      />
                    }
                    title={
                      <span className="truncate text-sm font-medium">
                        {hold.customerName || t("table.unknownCustomer")}
                      </span>
                    }
                    subtitle={
                      <>
                        <span className="shrink-0">#{hold.reservationNumber}</span>
                        {isUrgent ? (
                          <Badge variant="warning" size="sm">
                            {describeExpiry(expiry, hold.expiresAt)}
                          </Badge>
                        ) : (
                          <span className="truncate">
                            · {describeExpiry(expiry, hold.expiresAt)}
                          </span>
                        )}
                      </>
                    }
                    meta={formatMoney(hold.amount)}
                  />
                );
              })}
            </div>
          )}
        </DashboardSectionCard>

        <DashboardSectionCard
          title={t("deposits.toReturnTitle")}
          description={t("deposits.toReturnDescription")}
          icon={Undo2}
          accent="pending"
          action={
            data.toReturn.length > 0 && (
              <Badge variant="outline">
                {t("deposits.toReturnTotal", { amount: formatMoney(data.toReturnTotal) })}
              </Badge>
            )
          }
        >
          {data.toReturn.length === 0 ? (
            <DashboardEmptyState icon={Undo2} description={t("deposits.toReturnEmpty")} />
          ) : (
            <div className="-mx-2 sm:-mx-3">
              {data.toReturn.map((deposit) => {
                const isRentalOver = deposit.reservationStatus === "completed";
                return (
                  <DashboardListRow
                    key={deposit.reservationId}
                    href={`/dashboard/reservations/${deposit.reservationId}`}
                    leading={
                      <DashboardIconTile
                        icon={Undo2}
                        accent={isRentalOver ? "pending" : "neutral"}
                        size="sm"
                      />
                    }
                    title={
                      <span className="truncate text-sm font-medium">
                        {deposit.customerName || t("table.unknownCustomer")}
                      </span>
                    }
                    subtitle={
                      <>
                        <span className="shrink-0">#{deposit.reservationNumber}</span>
                        {isRentalOver ? (
                          <Badge variant="warning" size="sm">
                            {t("deposits.rentalOver")}
                          </Badge>
                        ) : (
                          <span className="truncate">
                            ·{" "}
                            {t("deposits.cashedReturned", {
                              cashed: formatMoney(deposit.cashed),
                              returned: formatMoney(deposit.returned),
                            })}
                          </span>
                        )}
                      </>
                    }
                    meta={formatMoney(deposit.remaining)}
                  />
                );
              })}
            </div>
          )}
        </DashboardSectionCard>
      </div>

      <DashboardSectionCard
        title={t("deposits.historyTitle")}
        description={t("deposits.historyDescription")}
        icon={History}
        accent="neutral"
      >
        {data.history.length === 0 ? (
          <DashboardEmptyState icon={History} description={t("deposits.historyEmpty")} />
        ) : (
          <div className="-mx-2 sm:-mx-3">
            {data.history.map((entry) => (
              <DashboardListRow
                key={entry.paymentId}
                href={`/dashboard/reservations/${entry.reservationId}`}
                leading={<DashboardIconTile icon={History} accent="neutral" size="sm" />}
                title={
                  <span className="truncate text-sm font-medium">
                    {t(`deposits.${EVENT_LABEL_KEYS[entry.event]}`)}
                  </span>
                }
                subtitle={
                  <span className="truncate">
                    {entry.customerName || t("table.unknownCustomer")} · #{entry.reservationNumber}{" "}
                    · {formatStoreDate(entry.date, timezone, "SHORT_DATE", locale)}
                  </span>
                }
                meta={
                  EVENT_SIGN[entry.event] === 0 ? (
                    <span className="text-muted-foreground font-normal">
                      {formatMoney(entry.amount)}
                    </span>
                  ) : (
                    <FinancesMovementAmount amount={entry.amount * EVENT_SIGN[entry.event]} />
                  )
                }
              />
            ))}
          </div>
        )}
      </DashboardSectionCard>
    </div>
  );
};
