"use client";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { z } from "zod";

import type { PartnerBooking } from "@louez/api/contracts/partners";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  toastManager,
} from "@louez/ui";
import { formatCurrency, getCurrencySymbol } from "@louez/utils";

import { useAppForm } from "@/hooks/form/form";
import { apiErrorKey } from "@/lib/orpc/errors";
import { partnersMutations, partnersQueries } from "@/lib/queries/partners.queries";

interface PartnerAdjustDialogProps {
  booking: PartnerBooking | null;
  currency: string;
  onClose: () => void;
  onAdjusted: (removed: boolean) => void;
}

/**
 * Sets what the store really owes for one reservation (a partial refund, a
 * gesture), with a reason the statement shows; or goes back to the rule.
 */
export const PartnerAdjustDialog = ({
  booking,
  currency,
  onClose,
  onAdjusted,
}: PartnerAdjustDialogProps) => {
  const t = useTranslations("dashboard.partners.adjust");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const adjust = useMutation(partnersMutations.adjustCommission());

  const schema = z.object({
    amount: z.string().refine((value) => {
      const amount = Number(value.replace(",", "."));
      return value.trim() !== "" && Number.isFinite(amount) && amount >= 0;
    }, t("amountInvalid")),
    note: z.string().max(200),
  });

  const save = async (amount: number | null, note: string) => {
    if (!booking) return;
    try {
      await adjust.mutateAsync({ reservationId: booking.reservationId, amount, note });
      await queryClient.invalidateQueries({ queryKey: partnersQueries.key() });
      onAdjusted(amount === null);
      onClose();
    } catch (error) {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
    }
  };

  const form = useAppForm({
    // The parent keys this dialog by reservation: each one opens on its own values.
    defaultValues: {
      amount: booking ? String(booking.commission) : "",
      note: booking?.adjustment?.note ?? "",
    },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    validators: { onSubmit: schema },
    onSubmit: ({ value }) => save(Number(value.amount.replace(",", ".")), value.note),
  });

  return (
    <Dialog
      open={booking !== null}
      onOpenChange={(open) => {
        if (open || !booking) return;
        onClose();
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        {booking && (
          <form.AppForm>
            <form.Form className="contents" formName="partner-adjust">
              <DialogHeader>
                <DialogTitle>{t("title", { number: booking.number })}</DialogTitle>
                <DialogDescription>
                  {t("description", { amount: formatCurrency(booking.computed, currency) })}
                </DialogDescription>
              </DialogHeader>
              <DialogPanel className="space-y-4">
                <form.AppField name="amount">
                  {(field) => (
                    <field.Input
                      label={t("amount")}
                      inputMode="decimal"
                      suffix={getCurrencySymbol(currency)}
                    />
                  )}
                </form.AppField>
                <form.AppField name="note">
                  {(field) => <field.Input label={t("note")} placeholder={t("notePlaceholder")} />}
                </form.AppField>
              </DialogPanel>
              <DialogFooter>
                {booking.adjustment && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={adjust.isPending}
                    onClick={() => void save(null, "")}
                  >
                    {t("reset")}
                  </Button>
                )}
                <form.SubscribeButton>{t("save")}</form.SubscribeButton>
              </DialogFooter>
            </form.Form>
          </form.AppForm>
        )}
      </DialogPopup>
    </Dialog>
  );
};
