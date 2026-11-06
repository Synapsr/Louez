"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileText } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";

import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetTitle,
  Skeleton,
} from "@louez/ui";

import { CopyButton } from "@/components/ui/copy-button";
import { useStore } from "@/contexts/store-context";
import { useFormatMoney } from "@/hooks/use-format-money";
import { orpc } from "@/lib/orpc/react";
import { formatStoreDate } from "@/lib/utils/store-date";

import { NATURE_LABEL_KEYS } from "./finances.constants";
import { FinancesMovementAmount } from "./finances-movement-amount";
import { FinancesMovementStatusBadge } from "./finances-movement-status-badge";
import { FinancesRelatedMovement } from "./finances-related-movement";

interface FinancesMovementSheetProps {
  /** Payment to show; `null` keeps the sheet closed. */
  movementId: string | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (movementId: string) => void;
}

/** One movement in full: where it comes from, what it was refunded by, how to find it in Stripe. */
export const FinancesMovementSheet = ({
  movementId,
  onOpenChange,
  onSelect,
}: FinancesMovementSheetProps) => {
  const t = useTranslations("dashboard.finances");
  const locale = useLocale();
  const { timezone } = useStore();
  const formatMoney = useFormatMoney();

  const detailQuery = useQuery({
    ...orpc.dashboard.finances.movementDetail.queryOptions({
      input: { paymentId: movementId ?? "" },
    }),
    enabled: movementId !== null,
  });

  const detail = detailQuery.data;
  const movement = detail?.movement;
  const stripeIds = movement
    ? [
        { key: "stripePaymentIntent", value: movement.stripePaymentIntentId },
        { key: "stripeCharge", value: movement.stripeChargeId },
        { key: "stripeCheckoutSession", value: movement.stripeCheckoutSessionId },
        { key: "stripeRefund", value: movement.stripeRefundId },
      ].flatMap((entry) => (entry.value ? [{ key: entry.key, value: entry.value }] : []))
    : [];
  const refundedSince = movement ? movement.amount - movement.storedAmount : 0;

  return (
    <Sheet
      open={movementId !== null}
      onOpenChange={(open) => {
        if (!open) onOpenChange(false);
      }}
    >
      <SheetContent side="right" className="sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{t("detail.title")}</SheetTitle>
          {movement && (
            <SheetDescription>
              {t(`nature.${NATURE_LABEL_KEYS[movement.nature]}`)} · #{movement.reservationNumber}
            </SheetDescription>
          )}
        </SheetHeader>

        <SheetPanel className="space-y-6">
          {detailQuery.isPending && (
            <div className="space-y-3">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {detailQuery.isError && <p className="text-muted-foreground text-sm">{t("loadError")}</p>}

          {detail && movement && (
            <>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <FinancesMovementAmount
                    amount={movement.amount}
                    counted={movement.counted}
                    className="text-2xl font-bold tracking-tight"
                  />
                  <FinancesMovementStatusBadge status={movement.status} />
                </div>
                {!movement.counted && (
                  <p className="text-muted-foreground text-sm">{t("detail.notCounted")}</p>
                )}
                {/* A Stripe charge is stored net of its refunds; the ledger shows what was taken. */}
                {movement.counted && refundedSince > 0 && (
                  <p className="text-muted-foreground text-sm">
                    {t("detail.grossNotice", {
                      refunded: formatMoney(refundedSince),
                      net: formatMoney(movement.storedAmount),
                    })}
                  </p>
                )}
              </div>

              <dl className="divide-y rounded-lg border text-sm">
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <dt className="text-muted-foreground">{t("detail.date")}</dt>
                  <dd className="text-right font-medium">
                    {formatStoreDate(movement.date, timezone, "DATE_AT_TIME", locale)}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <dt className="text-muted-foreground">{t("detail.method")}</dt>
                  <dd className="text-right font-medium">{t(`methods.${movement.method}`)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <dt className="text-muted-foreground">{t("detail.status")}</dt>
                  <dd className="text-right font-medium">{t(`status.${movement.status}`)}</dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <dt className="text-muted-foreground">{t("detail.customer")}</dt>
                  <dd className="truncate text-right font-medium">
                    {movement.customerName || t("table.unknownCustomer")}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <dt className="text-muted-foreground">{t("detail.reservation")}</dt>
                  <dd className="text-right font-medium">#{movement.reservationNumber}</dd>
                </div>
              </dl>

              {movement.notes && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-medium">{t("detail.notes")}</h3>
                  <p className="text-muted-foreground text-sm whitespace-pre-line">
                    {movement.notes}
                  </p>
                </section>
              )}

              {detail.original && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-medium">{t("detail.original")}</h3>
                  <FinancesRelatedMovement movement={detail.original} onSelect={onSelect} />
                </section>
              )}

              {detail.refunds.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-medium">{t("detail.refunds")}</h3>
                  <div className="space-y-1.5">
                    {detail.refunds.map((refund) => (
                      <FinancesRelatedMovement
                        key={refund.id}
                        movement={refund}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                </section>
              )}

              {stripeIds.length > 0 && (
                <section className="space-y-1.5">
                  <h3 className="text-sm font-medium">{t("detail.stripe")}</h3>
                  <dl className="divide-y rounded-lg border text-sm">
                    {stripeIds.map((entry) => (
                      <div key={entry.key} className="flex items-center gap-2 py-1 pr-1 pl-3">
                        <dt className="text-muted-foreground w-32 shrink-0">
                          {t(`detail.${entry.key}`)}
                        </dt>
                        <dd className="min-w-0 flex-1 truncate font-mono text-xs">{entry.value}</dd>
                        <CopyButton value={entry.value} label={t("detail.copy")} size="xs" />
                      </div>
                    ))}
                  </dl>
                </section>
              )}
            </>
          )}
        </SheetPanel>

        {detail && movement && (
          <SheetFooter>
            {detail.invoice && (
              <Button
                variant="outline"
                render={
                  <a
                    href={`/api/reservations/${movement.reservationId}/invoices/${detail.invoice.id}`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                <FileText />
                {t(detail.invoice.type === "credit_note" ? "detail.creditNote" : "detail.invoice", {
                  number: detail.invoice.number,
                })}
              </Button>
            )}
            <Button render={<Link href={`/dashboard/reservations/${movement.reservationId}`} />}>
              <ExternalLink />
              {t("detail.openReservation")}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
};
