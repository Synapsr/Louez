"use client";

import { useState } from "react";

import { CheckCircle2, Circle, Loader2, PenLine, RotateCcw, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  InputPrice,
  Label,
  Separator,
  ToggleGroup,
  ToggleGroupItem,
} from "@louez/ui";
import { cn, formatCurrency } from "@louez/utils";

import { useFormatLocale } from "@/hooks/use-format-locale";
import { formatStoreDate } from "@/lib/utils/store-date";

import { useReservationDurationLabel } from "../hooks/use-reservation-duration-label";
import type { Customer, DetailedDuration, ReservationStepId } from "../types";

export type ReservationSectionId = Exclude<ReservationStepId, "confirm">;

export interface ReservationDiscount {
  mode: "amount" | "percent";
  value: number | null;
}

interface SectionChecklistItem {
  id: ReservationSectionId;
  label: string;
  done: boolean;
}

interface NewReservationSummaryPanelProps {
  selectedCustomer: Customer | undefined;
  /** True while the selected customer was created from this form. */
  isNewCustomer: boolean;
  startDate: Date | undefined;
  endDate: Date | undefined;
  duration: number;
  detailedDuration: DetailedDuration | null;
  timezone: string | undefined;
  itemCount: number;
  isDeliveryEnabled: boolean;
  isDeliveryReady: boolean;
  subtotal: number;
  tulipInsuranceAmount: number;
  isTulipInsuranceQuoteLoading: boolean;
  deliveryFee: number;
  deposit: number;
  discount: ReservationDiscount;
  /** Discount resolved in currency units, already clamped to the subtotal. */
  discountAmount: number;
  onDiscountChange: (discount: ReservationDiscount) => void;
  depositOverride: number | null;
  onDepositOverrideChange: (value: number | null) => void;
  sendConfirmationEmail: boolean;
  onSendConfirmationEmailChange: (checked: boolean) => void;
  onNavigateToSection: (sectionId: ReservationSectionId) => void;
}

export function NewReservationSummaryPanel({
  selectedCustomer,
  isNewCustomer,
  startDate,
  endDate,
  duration,
  detailedDuration,
  timezone,
  itemCount,
  isDeliveryEnabled,
  isDeliveryReady,
  subtotal,
  tulipInsuranceAmount,
  isTulipInsuranceQuoteLoading,
  deliveryFee,
  deposit,
  discount,
  discountAmount,
  onDiscountChange,
  depositOverride,
  onDepositOverrideChange,
  sendConfirmationEmail,
  onSendConfirmationEmailChange,
  onNavigateToSection,
}: NewReservationSummaryPanelProps) {
  const t = useTranslations("dashboard.reservations.manualForm");
  const { intl: formatLocale } = useFormatLocale();
  const [isEditingDiscount, setIsEditingDiscount] = useState(false);
  const [isEditingDeposit, setIsEditingDeposit] = useState(false);

  const effectiveDeposit = depositOverride ?? deposit;

  const isCustomerDone = Boolean(selectedCustomer);
  const isPeriodDone = Boolean(startDate && endDate && endDate >= startDate);

  const checklist: SectionChecklistItem[] = [
    { id: "customer", label: t("steps.customer"), done: isCustomerDone },
    { id: "period", label: t("steps.period"), done: isPeriodDone },
    { id: "products", label: t("steps.products"), done: itemCount > 0 },
    ...(isDeliveryEnabled
      ? [
          {
            id: "delivery" as const,
            label: t("steps.delivery"),
            done: isDeliveryReady,
          },
        ]
      : []),
  ];
  const doneCount = checklist.filter((item) => item.done).length;

  const customerName = selectedCustomer
    ? `${selectedCustomer.firstName} ${selectedCustomer.lastName}`
    : null;
  const customerEmail = selectedCustomer?.email;

  const durationLabel = useReservationDurationLabel(detailedDuration, duration);

  const total = subtotal + tulipInsuranceAmount + deliveryFee - discountAmount;

  return (
    <Card>
      {/* Below `lg` this card sheds its recap half — the confirmation sheet
          owns that job now — and keeps only the three controls that live
          nowhere else. Swapped in CSS rather than JS so the heading never
          flashes the wrong wording during hydration. */}
      <CardHeader>
        <CardTitle>
          <span className="max-lg:hidden">{t("confirmTitle")}</span>
          <span className="lg:hidden">{t("adjustmentsTitle")}</span>
        </CardTitle>
        <CardDescription>
          <span className="max-lg:hidden">{t("confirmDescription")}</span>
          <span className="lg:hidden">{t("adjustmentsDescription")}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Section completeness checklist. Stacked under the whole form on a
            phone, it arrives after you have scrolled past everything it
            reports on — and submitting already scrolls to the first gap. */}
        <div className="max-lg:hidden space-y-2.5">
          <div className="flex items-center justify-between">
            <Label>{t("summary")}</Label>
            <span className="text-muted-foreground text-xs tabular-nums">
              {doneCount}/{checklist.length}
            </span>
          </div>
          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onNavigateToSection(item.id)}
                  className="flex w-full items-center gap-2 rounded-md text-left text-sm hover:underline"
                >
                  {item.done ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <Circle className="text-muted-foreground/40 h-4 w-4 shrink-0" />
                  )}
                  <span className={item.done ? "" : "text-muted-foreground"}>{item.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {(customerName || isPeriodDone) && <Separator className="max-lg:hidden" />}

        {/* Customer recap — duplicated by the confirmation sheet on a phone. */}
        {customerName && (
          <div className="max-lg:hidden space-y-0.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{customerName}</p>
              {isNewCustomer && (
                <Badge variant="progress" className="h-5 shrink-0 px-1.5 text-[10px]">
                  {t("newCustomerBadge")}
                </Badge>
              )}
            </div>
            {customerEmail && (
              <p className="text-muted-foreground truncate text-xs">{customerEmail}</p>
            )}
          </div>
        )}

        {/* Period recap — duplicated by the confirmation sheet on a phone. */}
        {isPeriodDone && startDate && endDate && (
          <div className="max-lg:hidden space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t("startDate")}</span>
              <span className="tabular-nums">
                {formatStoreDate(startDate, timezone, "d MMM yyyy HH:mm", formatLocale)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t("endDate")}</span>
              <span className="tabular-nums">
                {formatStoreDate(endDate, timezone, "d MMM yyyy HH:mm", formatLocale)}
              </span>
            </div>
            <div className="flex justify-between gap-2 font-medium">
              <span>{t("duration")}</span>
              <span>{durationLabel}</span>
            </div>
          </div>
        )}

        {/* Nothing to separate from once the recap above is hidden. */}
        <Separator className="max-lg:hidden" />

        {/* Totals */}
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground">{t("subtotal")}</span>
            <span className="tabular-nums">{formatCurrency(subtotal)}</span>
          </div>
          {(tulipInsuranceAmount > 0 || isTulipInsuranceQuoteLoading) && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t("tulipInsurance.title")}</span>
              {isTulipInsuranceQuoteLoading ? (
                <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" />
              ) : (
                <span className="tabular-nums">{formatCurrency(tulipInsuranceAmount)}</span>
              )}
            </div>
          )}
          {deliveryFee > 0 && (
            <div className="flex justify-between gap-2">
              <span className="text-muted-foreground">{t("totalDeliveryFee")}</span>
              <span className="tabular-nums">{formatCurrency(deliveryFee)}</span>
            </div>
          )}

          {/* Commercial discount */}
          {isEditingDiscount || discount.value != null ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("globalDiscount.label")}</span>
                <span className="flex items-center gap-1">
                  {discountAmount > 0 && (
                    <span className="tabular-nums text-green-600">
                      -{formatCurrency(discountAmount)}
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive h-6 w-6"
                    aria-label={t("globalDiscount.remove")}
                    onClick={() => {
                      onDiscountChange({ mode: discount.mode, value: null });
                      setIsEditingDiscount(false);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <ToggleGroup
                  value={[discount.mode]}
                  onValueChange={(groupValue) => {
                    const mode = groupValue[0] as ReservationDiscount["mode"] | undefined;
                    if (mode) onDiscountChange({ mode, value: discount.value });
                  }}
                >
                  <ToggleGroupItem value="amount" aria-label="€">
                    €
                  </ToggleGroupItem>
                  <ToggleGroupItem value="percent" aria-label="%">
                    %
                  </ToggleGroupItem>
                </ToggleGroup>
                <InputPrice
                  value={discount.value ?? 0}
                  displayEmpty={discount.value == null}
                  onValueCommitted={(value) =>
                    onDiscountChange({ mode: discount.mode, value: Math.max(0, value) })
                  }
                  onEmptyCommitted={() => onDiscountChange({ mode: discount.mode, value: null })}
                  placeholder="0.00"
                  suffix={discount.mode === "amount" ? "€" : "%"}
                  ariaLabel={t("globalDiscount.label")}
                  className="min-w-0 flex-1"
                />
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsEditingDiscount(true)}
              className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
            >
              + {t("globalDiscount.add")}
            </button>
          )}

          {/* Deposit, editable */}
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{t("deposit")}</span>
            {isEditingDeposit ? (
              <InputPrice
                value={effectiveDeposit}
                onValueCommitted={(value) => {
                  onDepositOverrideChange(Math.max(0, value));
                  setIsEditingDeposit(false);
                }}
                placeholder="0.00"
                suffix="€"
                ariaLabel={t("deposit")}
                className="w-32"
              />
            ) : (
              <span className="flex items-center gap-1">
                {depositOverride != null && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground h-6 w-6"
                    aria-label={t("priceOverride.reset")}
                    onClick={() => onDepositOverrideChange(null)}
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                )}
                <span
                  className={cn(
                    "tabular-nums",
                    depositOverride != null && "font-medium text-orange-600",
                  )}
                >
                  {formatCurrency(effectiveDeposit)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground hover:text-foreground h-6 w-6"
                  aria-label={t("priceOverride.dialogTitle")}
                  onClick={() => setIsEditingDeposit(true)}
                >
                  <PenLine className="h-3 w-3" />
                </Button>
              </span>
            )}
          </div>

          <Separator className="my-2" />
          <div className="flex justify-between gap-2 text-base font-semibold">
            <span>{t("total")}</span>
            <span className="tabular-nums">{formatCurrency(total)}</span>
          </div>
        </div>

        <Separator />

        <div className="flex items-center space-x-2">
          <Checkbox
            id="sendConfirmationEmail"
            checked={sendConfirmationEmail}
            onCheckedChange={(checked) => onSendConfirmationEmailChange(checked === true)}
          />
          <label
            htmlFor="sendConfirmationEmail"
            className="text-muted-foreground min-w-0 cursor-pointer text-sm leading-tight"
          >
            {t("sendConfirmationEmail")}
          </label>
        </div>
      </CardContent>
    </Card>
  );
}
