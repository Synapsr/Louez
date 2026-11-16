"use client";

import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  Shield,
  Send,
  Mail,
  MessageSquare,
  Copy,
  Check,
  AlertCircle,
  Receipt,
} from "lucide-react";
import { toastManager } from "@louez/ui";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@louez/ui";
import { Label } from "@louez/ui";
import { Textarea } from "@louez/ui";
import { Input } from "@louez/ui";
import { Checkbox } from "@louez/ui";
import { cn, currencyMinorDigits, formatCurrency } from "@louez/utils";
import { paymentAmount } from "@louez/api/services/payment-amount";

import { orpc } from "@/lib/orpc/react";
import { customRequestAmount } from "@/lib/reservations/util.payment-request";
import { typedAmount } from "@/lib/reservations/util.typed-amount";
import { invalidateReservationAll } from "@/lib/orpc/invalidation";
import { reservationAnalyticsActions } from "@/lib/product-analytics/analytics-events";
import {
  captureReservationActionFailed,
  captureReservationActionStarted,
} from "@/lib/product-analytics/reservation-analytics-client";

interface RequestPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationId: string;
  reservationNumber: string;
  customer: {
    firstName: string;
    email: string;
    phone?: string | null;
  };
  totalAmount: number;
  paidAmount: number;
  depositAmount: number;
  depositStatus?: string | null;
  currency: string;
  stripeConfigured: boolean;
}

type PaymentType = "rental" | "deposit" | "custom";

export function RequestPaymentModal({
  open,
  onOpenChange,
  reservationId,
  reservationNumber: _reservationNumber,
  customer,
  totalAmount,
  paidAmount,
  depositAmount,
  depositStatus,
  currency,
  stripeConfigured,
}: RequestPaymentModalProps) {
  const t = useTranslations("dashboard.reservations.requestPaymentModal");
  const tReservations = useTranslations("dashboard.reservations");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  const [selectedType, setSelectedType] = useState<PaymentType | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  // Whether the person changed the custom amount: its refusal shows from then on.
  const [customTouched, setCustomTouched] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(false);
  const [customMessage, setCustomMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const remainingRental = totalAmount - paidAmount;
  const canRequestDeposit =
    depositAmount > 0 && depositStatus !== "held" && depositStatus !== "captured";
  const canRequestRental = remainingRental >= 0.5;
  const hasPhone = !!customer.phone;

  const paymentTypes = useMemo(() => {
    const types: Array<{
      id: PaymentType;
      icon: React.ReactNode;
      iconBg: string;
      available: boolean;
      amount?: number;
    }> = [];

    if (canRequestRental) {
      types.push({
        id: "rental",
        icon: <Receipt className="h-4 w-4" />,
        iconBg: "bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-400",
        available: true,
        amount: remainingRental,
      });
    }

    if (canRequestDeposit) {
      types.push({
        id: "deposit",
        icon: <Shield className="h-4 w-4" />,
        iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-900/50 dark:text-amber-400",
        available: true,
        amount: depositAmount,
      });
    }

    types.push({
      id: "custom",
      icon: <CreditCard className="h-4 w-4" />,
      iconBg: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
      available: true,
    });

    return types;
  }, [canRequestRental, canRequestDeposit, remainingRental, depositAmount]);

  // A custom amount as typed, judged by the action's own function: the
  // reservation's currency and its decimals, never a number rounded first.
  const custom = useMemo(
    () => customRequestAmount(typedAmount(customAmount) ?? "", currency),
    [customAmount, currency],
  );
  const selectedAmount = useMemo(() => {
    if (selectedType === "rental") return remainingRental;
    if (selectedType === "deposit") return depositAmount;
    if (selectedType === "custom") return custom.ok ? custom.amount : 0;
    return 0;
  }, [selectedType, custom, remainingRental, depositAmount]);

  const isValidAmount = selectedType === "custom" ? custom.ok : selectedAmount >= 0.5;
  // The field's own minimum: one whole unit in a currency without decimals, where
  // 0.50 would make every whole amount a step mismatch; 0.50 otherwise.
  const decimals = currencyMinorDigits(currency);
  const fieldMinimum = decimals === 0 ? "1" : "0.50";
  const typedCustom = typedAmount(customAmount) ?? "";
  const customRefusal = custom.ok
    ? null
    : custom.error === "errors.amountTooPrecise"
      ? tReservations("payment.amountTooPrecise", { currency, decimals: decimals ?? 0 })
      : custom.error === "errors.currencyNotSupportedForPayments"
        ? tReservations("payment.currencyNotSupported", { currency })
        : // A plain amount above zero is below the minimum; anything else (empty, as a
          // browser gives what it refused, or malformed) is no amount.
          paymentAmount(typedCustom) !== null && !typedCustom.startsWith("-")
          ? t("minAmount", { amount: formatCurrency(Number(fieldMinimum), currency) })
          : tReservations("payment.invalidAmount");
  const hasChannel = sendEmail || sendSms;
  const canSubmit = selectedType && isValidAmount && hasChannel && stripeConfigured;

  const requestPaymentMutation = useMutation(
    orpc.dashboard.reservations.requestPayment.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservationId);
      },
    }),
  );

  const handleSubmit = async () => {
    if (!canSubmit) return;

    captureReservationActionStarted({
      reservationId,
      action: reservationAnalyticsActions.requestPayment,
      properties: {
        payment_type: selectedType,
        channel_email: sendEmail,
        channel_sms: sendSms,
      },
    });

    setIsLoading(true);
    try {
      const result = await requestPaymentMutation.mutateAsync({
        reservationId,
        payload: {
          type: selectedType,
          amount: selectedType === "custom" ? (typedAmount(customAmount) ?? "") : undefined,
          channels: { email: sendEmail, sms: sendSms },
          customMessage: customMessage || undefined,
        },
      });

      toastManager.add({ title: t("success"), type: "success" });
      if (result.paymentUrl) {
        setPaymentUrl(result.paymentUrl);
      }
    } catch {
      captureReservationActionFailed({
        reservationId,
        action: reservationAnalyticsActions.requestPayment,
        properties: {
          payment_type: selectedType,
          channel_email: sendEmail,
          channel_sms: sendSms,
          error_code: "payment_request_failed",
        },
      });
      toastManager.add({ title: t("error"), type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    if (!paymentUrl) return;
    try {
      await navigator.clipboard.writeText(paymentUrl);
      setCopied(true);
      toastManager.add({ title: t("linkCopied"), type: "success" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toastManager.add({ title: t("copyFailed"), type: "error" });
    }
  };

  const resetForm = () => {
    setSelectedType(null);
    setCustomAmount("");
    setCustomTouched(false);
    setSendEmail(true);
    setSendSms(false);
    setCustomMessage("");
    setPaymentUrl(null);
    setCopied(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  // Success view after sending
  if (paymentUrl) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogPopup className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Check className="h-5 w-5 text-green-600" />
              {t("successTitle")}
            </DialogTitle>
            <DialogDescription>
              {t("successDescription", {
                channel: sendEmail && sendSms ? "email et SMS" : sendEmail ? "email" : "SMS",
              })}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel>
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/50 text-sm">
                <Label className="text-xs text-muted-foreground mb-2 block">
                  {t("paymentLink")}
                </Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 text-xs break-all font-mono bg-background p-2 rounded border">
                    {paymentUrl}
                  </code>
                  <Button variant="outline" onClick={handleCopyLink} className="shrink-0">
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </div>
          </DialogPanel>

          <DialogFooter>
            <Button onClick={() => handleOpenChange(false)}>{tCommon("close")}</Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description", { name: customer.firstName })}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          {!stripeConfigured ? (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-amber-800 dark:text-amber-200">
                  {t("stripeNotConfigured")}
                </p>
                <p className="text-amber-700 dark:text-amber-300 mt-1">
                  {t("stripeNotConfiguredDescription")}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Payment type selection */}
              <div className="space-y-2">
                <Label>{t("paymentType")}</Label>
                <div className="grid gap-2">
                  {paymentTypes.map((type) => {
                    const isSelected = selectedType === type.id;

                    return (
                      <button
                        key={type.id}
                        type="button"
                        onClick={() => setSelectedType(type.id)}
                        className={cn(
                          "flex items-start gap-3 p-3 rounded-lg border text-left transition-all",
                          "hover:border-primary/50 hover:bg-muted/50",
                          isSelected && "border-primary bg-primary/5 ring-1 ring-primary/20",
                        )}
                      >
                        <div className={cn("mt-0.5 p-2 rounded-lg shrink-0", type.iconBg)}>
                          {type.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm">
                              {t(`types.${type.id}.name`)}
                            </span>
                            {type.amount && (
                              <span className="text-sm font-semibold">
                                {formatCurrency(type.amount, currency)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {t(`types.${type.id}.description`)}
                          </p>
                        </div>
                        <div
                          className={cn(
                            "w-4 h-4 rounded-full border-2 shrink-0 mt-1 transition-colors",
                            isSelected ? "border-primary bg-primary" : "border-muted-foreground/30",
                          )}
                        >
                          {isSelected && (
                            <Check className="h-full w-full p-0.5 text-primary-foreground" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Custom amount input */}
              {selectedType === "custom" && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <Label htmlFor="amount">{t("customAmount")}</Label>
                  <div className="relative">
                    <Input
                      id="amount"
                      type="number"
                      step={currencyMinorDigits(currency) === 0 ? "1" : "0.01"}
                      min={fieldMinimum}
                      value={customAmount}
                      onChange={(e) => {
                        setCustomAmount(e.target.value);
                        setCustomTouched(true);
                      }}
                      placeholder="0.00"
                      className="pr-12"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                      {currency}
                    </span>
                  </div>
                  {customTouched && customRefusal && (
                    <p className="text-xs text-destructive">{customRefusal}</p>
                  )}
                </div>
              )}

              {/* Send via channels */}
              {selectedType && (
                <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                  <Label>{t("sendVia")}</Label>
                  <div className="space-y-2">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="email"
                        checked={sendEmail}
                        onCheckedChange={(checked) => setSendEmail(!!checked)}
                      />
                      <label
                        htmlFor="email"
                        className="flex items-center gap-2 text-sm cursor-pointer"
                      >
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        {t("email")}
                        <span className="text-muted-foreground">({customer.email})</span>
                      </label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="sms"
                        checked={sendSms}
                        onCheckedChange={(checked) => setSendSms(!!checked)}
                        disabled={!hasPhone}
                      />
                      <label
                        htmlFor="sms"
                        className={cn(
                          "flex items-center gap-2 text-sm cursor-pointer",
                          !hasPhone && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                        {t("sms")}
                        {hasPhone ? (
                          <span className="text-muted-foreground">({customer.phone})</span>
                        ) : (
                          <span className="text-muted-foreground italic">({t("noPhone")})</span>
                        )}
                      </label>
                    </div>
                  </div>
                  {!hasChannel && <p className="text-xs text-destructive">{t("selectChannel")}</p>}
                </div>
              )}

              {/* Custom message */}
              {selectedType && (
                <div className="space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                  <Label htmlFor="message">
                    {t("customMessage")}
                    <span className="text-muted-foreground font-normal ml-1">
                      ({tCommon("other").toLowerCase()})
                    </span>
                  </Label>
                  <Textarea
                    id="message"
                    value={customMessage}
                    onChange={(e) => setCustomMessage(e.target.value)}
                    placeholder={t("customMessagePlaceholder")}
                    rows={2}
                    className="resize-none"
                  />
                </div>
              )}

              {/* Summary */}
              {selectedType && isValidAmount && (
                <div className="p-3 rounded-lg bg-muted/50 text-sm animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">{t("amountToRequest")}</span>
                    <span className="font-semibold text-lg">
                      {formatCurrency(selectedAmount, currency)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogPanel>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={isLoading}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleSubmit} isPending={isLoading} disabled={!canSubmit}>
            <Send data-slot="icon" />
            {t("send")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
