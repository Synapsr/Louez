"use client";

import { AlertTriangle, Check, FileText, Mail, MailX } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Badge,
  Button,
  Drawer,
  DrawerClose,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
  Separator,
} from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { useFormatLocale } from "@/hooks/use-format-locale";
import { formatStoreDate } from "@/lib/utils/store-date";

import type { AvailabilityWarning, Customer, PeriodWarning } from "../types";
import type { ReservationRecapDeliveryLeg, ReservationRecapItemLine } from "../utils/recap-lines";

interface NewReservationConfirmDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Quote mode only relabels the sheet — the recap itself is identical. */
  asQuote: boolean;
  isSubmitting: boolean;
  onConfirm: () => void;

  customer: Customer | undefined;
  isNewCustomer: boolean;

  startDate: Date | undefined;
  endDate: Date | undefined;
  durationLabel: string;
  timezone: string | undefined;

  itemLines: ReservationRecapItemLine[];

  outboundLeg: ReservationRecapDeliveryLeg | null;
  returnLeg: ReservationRecapDeliveryLeg | null;

  subtotal: number;
  tulipInsuranceAmount: number;
  deliveryFee: number;
  discountAmount: number;
  /** Deposit after any manual override, i.e. what will actually be held. */
  deposit: number;
  total: number;

  /** Resolved server-side rule, not the raw toggle — a quote always mails. */
  willSendConfirmationEmail: boolean;
  periodWarnings: PeriodWarning[];
  availabilityWarnings: AvailabilityWarning[];
}

/**
 * Last-mile recap before a reservation is written, shown on the stacked
 * layout where the summary panel sits below the fold and the action bar is
 * the only thing in reach. Read-only by design: correcting anything means
 * closing the sheet and going back to the field that owns it.
 */
export function NewReservationConfirmDrawer({
  open,
  onOpenChange,
  asQuote,
  isSubmitting,
  onConfirm,
  customer,
  isNewCustomer,
  startDate,
  endDate,
  durationLabel,
  timezone,
  itemLines,
  outboundLeg,
  returnLeg,
  subtotal,
  tulipInsuranceAmount,
  deliveryFee,
  discountAmount,
  deposit,
  total,
  willSendConfirmationEmail,
  periodWarnings,
  availabilityWarnings,
}: NewReservationConfirmDrawerProps) {
  const t = useTranslations("dashboard.reservations.manualForm");
  const tCommon = useTranslations("common");
  const { intl: formatLocale } = useFormatLocale();

  const hasWarnings = periodWarnings.length > 0 || availabilityWarnings.length > 0;
  const hasDelivery = Boolean(outboundLeg || returnLeg);
  const legs = [
    { id: "outbound", label: t("outboundLeg"), leg: outboundLeg },
    { id: "return", label: t("returnLeg"), leg: returnLeg },
  ].filter((entry) => entry.leg !== null);

  return (
    <Drawer position="bottom" open={open} onOpenChange={onOpenChange}>
      <DrawerPopup>
        <DrawerHeader>
          <DrawerTitle>
            {asQuote ? t("confirmDrawer.titleQuote") : t("confirmDrawer.title")}
          </DrawerTitle>
          <DrawerDescription>
            {asQuote ? t("confirmDrawer.descriptionQuote") : t("confirmDrawer.description")}
          </DrawerDescription>
        </DrawerHeader>

        <DrawerPanel className="space-y-4">
          {/* Warnings lead: they are the only reason to back out of this sheet. */}
          {hasWarnings && (
            <div className="bg-warning/10 space-y-2 rounded-xl px-3 py-2.5">
              <p className="flex items-center gap-2 text-xs font-semibold">
                <AlertTriangle className="text-warning h-3.5 w-3.5 shrink-0" />
                {t("confirmDrawer.warningsTitle")}
              </p>
              <ul className="space-y-1.5">
                {periodWarnings.map((warning, index) => (
                  <li
                    key={`${warning.type}-${warning.field}-${index}`}
                    className="text-muted-foreground text-xs"
                  >
                    {warning.message}
                  </li>
                ))}
                {availabilityWarnings.map((warning) => (
                  <li key={warning.productId} className="text-muted-foreground text-xs">
                    {t("warnings.productConflict", { name: warning.productName })} —{" "}
                    {t("warnings.productConflictDetails", {
                      requested: warning.requestedQuantity,
                      available: warning.availableQuantity,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Customer */}
          {customer && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {t("customer")}
              </p>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-sm font-medium">
                  {customer.firstName} {customer.lastName}
                </p>
                {isNewCustomer && (
                  <Badge variant="progress" className="h-5 shrink-0 px-1.5 text-[10px]">
                    {t("newCustomerBadge")}
                  </Badge>
                )}
              </div>
              {customer.email && (
                <p className="text-muted-foreground truncate text-xs">{customer.email}</p>
              )}
            </div>
          )}

          {/* Period */}
          {startDate && endDate && (
            <div className="space-y-1">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {t("period")}
              </p>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{t("startDate")}</span>
                <span className="tabular-nums">
                  {formatStoreDate(startDate, timezone, "d MMM yyyy HH:mm", formatLocale)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">{t("endDate")}</span>
                <span className="tabular-nums">
                  {formatStoreDate(endDate, timezone, "d MMM yyyy HH:mm", formatLocale)}
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-3 text-sm font-medium">
                <span>{t("duration")}</span>
                <span>{durationLabel}</span>
              </div>
            </div>
          )}

          {/* Items */}
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
              {t("products")}
            </p>
            <ul className="space-y-2">
              {itemLines.map((line) => (
                <li key={line.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate font-medium">
                      <span className="text-muted-foreground tabular-nums">{line.quantity}× </span>
                      {line.name}
                    </p>
                    {line.attributes.length > 0 && (
                      <p className="text-muted-foreground truncate text-xs">
                        {line.attributes.join(" · ")}
                      </p>
                    )}
                    {line.hasPriceOverride && (
                      <p className="text-xs text-orange-600">{t("priceOverride.modified")}</p>
                    )}
                  </div>
                  <span className="shrink-0 tabular-nums">{formatCurrency(line.total)}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Delivery */}
          {hasDelivery && (
            <div className="space-y-1.5">
              <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {t("deliveryTitle")}
              </p>
              {legs.map(({ id, label, leg }) => (
                <div key={id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">{label}</p>
                    <p className="truncate">
                      {leg?.label ??
                        (leg?.method === "address" ? t("deliveryYes") : t("storeLocationFallback"))}
                    </p>
                  </div>
                  {(leg?.fee ?? 0) > 0 && (
                    <span className="shrink-0 tabular-nums">{formatCurrency(leg?.fee ?? 0)}</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <Separator />

          {/* Totals */}
          <div className="space-y-1.5 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">{t("subtotal")}</span>
              <span className="tabular-nums">{formatCurrency(subtotal)}</span>
            </div>
            {tulipInsuranceAmount > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{t("tulipInsurance.title")}</span>
                <span className="tabular-nums">{formatCurrency(tulipInsuranceAmount)}</span>
              </div>
            )}
            {deliveryFee > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{t("totalDeliveryFee")}</span>
                <span className="tabular-nums">{formatCurrency(deliveryFee)}</span>
              </div>
            )}
            {discountAmount > 0 && (
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-muted-foreground">{t("globalDiscount.label")}</span>
                <span className="tabular-nums text-green-600">
                  -{formatCurrency(discountAmount)}
                </span>
              </div>
            )}

            <Separator className="my-2" />

            <div className="flex items-baseline justify-between gap-3 text-lg font-semibold">
              <span>{t("total")}</span>
              <span className="tabular-nums">{formatCurrency(total)}</span>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-muted-foreground">{t("deposit")}</span>
              <span className="tabular-nums">{formatCurrency(deposit)}</span>
            </div>
          </div>

          {/* What happens on confirm, spelled out — the toggle itself lives in
              the summary panel and is not reachable from here. */}
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            {willSendConfirmationEmail ? (
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <MailX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            )}
            {willSendConfirmationEmail ? t("confirmDrawer.emailOn") : t("confirmDrawer.emailOff")}
          </p>
        </DrawerPanel>

        <DrawerFooter>
          <DrawerClose render={<Button type="button" variant="outline" disabled={isSubmitting} />}>
            {tCommon("edit")}
          </DrawerClose>
          <Button type="button" onClick={onConfirm} isPending={isSubmitting}>
            {asQuote ? <FileText data-slot="icon" /> : <Check data-slot="icon" />}
            {asQuote ? t("sendAsQuote") : t("create")}
          </Button>
        </DrawerFooter>
      </DrawerPopup>
    </Drawer>
  );
}
