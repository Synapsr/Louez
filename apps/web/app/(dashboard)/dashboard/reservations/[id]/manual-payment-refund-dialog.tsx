"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toastManager,
} from "@louez/ui";

import { orpc } from "@/lib/orpc/react";
import { invalidateReservationAll } from "@/lib/orpc/invalidation";

import {
  isManualPaymentMethod,
  type ManualPaymentMethod,
} from "./util.payment-refunds";

interface ManualPaymentRefundDialogProps {
  reservationId: string;
  paymentId: string;
  remainingAmount: number;
  currencySymbol: string;
  defaultMethod: ManualPaymentMethod;
  onClose: () => void;
}

export const ManualPaymentRefundDialog = ({
  reservationId,
  paymentId,
  remainingAmount,
  currencySymbol,
  defaultMethod,
  onClose,
}: ManualPaymentRefundDialogProps) => {
  const t = useTranslations("dashboard.reservations");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const router = useRouter();
  const [amount, setAmount] = useState(remainingAmount.toFixed(2));
  const [method, setMethod] = useState<ManualPaymentMethod>(defaultMethod);
  const [notes, setNotes] = useState("");

  const refundMutation = useMutation(
    orpc.dashboard.reservations.refundManualPayment.mutationOptions({
      onSuccess: async () => {
        await invalidateReservationAll(queryClient, reservationId);
      },
    }),
  );

  const handleRefund = async () => {
    const parsedAmount = Number(amount);
    if (
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0 ||
      parsedAmount > remainingAmount
    ) {
      toastManager.add({ title: t("payment.invalidRefundAmount"), type: "error" });
      return;
    }

    try {
      const result = await refundMutation.mutateAsync({
        reservationId,
        payload: {
          paymentId,
          amount: parsedAmount,
          method,
          notes: notes.trim() || undefined,
        },
      });

      toastManager.add({
        title: result.creditNoteNumber
          ? t("payment.creditNoteGenerated", { number: result.creditNoteNumber })
          : t("payment.refundRecorded"),
        type: "success",
      });
      router.refresh();
      onClose();
    } catch (error) {
      const title =
        error instanceof Error && error.message.startsWith("errors.")
          ? tErrors(error.message.replace("errors.", ""))
          : tErrors("generic");
      toastManager.add({ title, type: "error" });
    }
  };

  const methodOptions: Array<{ value: ManualPaymentMethod; label: string }> = [
    { value: "cash", label: t("payment.methods.cash") },
    { value: "card", label: t("payment.methods.card") },
    { value: "transfer", label: t("payment.methods.transfer") },
    { value: "check", label: t("payment.methods.check") },
    { value: "other", label: t("payment.methods.other") },
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("payment.refundTitle")}</DialogTitle>
          <DialogDescription>
            {t("payment.refundDescription", {
              amount: `${remainingAmount.toFixed(2)}${currencySymbol}`,
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="manual-refund-amount">{t("payment.amount")}</Label>
              <Input
                id="manual-refund-amount"
                type="number"
                min="0.01"
                max={remainingAmount.toFixed(2)}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("payment.method")}</Label>
              <Select
                value={method}
                onValueChange={(value) => {
                  if (value && isManualPaymentMethod(value)) setMethod(value);
                }}
              >
                <SelectTrigger>
                  <SelectValue>
                    {methodOptions.find((option) => option.value === method)?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {methodOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value} label={option.label}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="manual-refund-notes">{t("payment.refundNote")}</Label>
              <Textarea
                id="manual-refund-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t("payment.refundNotePlaceholder")}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {tCommon("cancel")}
          </Button>
          <Button onClick={handleRefund} isPending={refundMutation.isPending}>
            {t("payment.refundConfirm")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
