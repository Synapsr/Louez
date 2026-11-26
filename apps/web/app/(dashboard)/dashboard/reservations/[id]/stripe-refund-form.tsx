"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircleIcon } from "lucide-react";

import {
  Alert,
  AlertDescription,
  Button,
  DialogFooter,
  DialogPanel,
  SelectItem,
  toastManager,
} from "@louez/ui";
import { currencyMinorDigits } from "@louez/utils";
import { decimalOfMinor, hundredthsOf } from "@louez/api/services/payment-amount";
import type {
  PreviewRefundOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
} from "@louez/api/contracts/stripe-refunds";

import { useAppForm } from "@/hooks/form/form";
import { invalidateReservationAll } from "@/lib/orpc/invalidation";
import { captureStripeRefundRequested } from "@/lib/product-analytics/reservation-analytics-client";
import { stripeRefundsMutations } from "@/lib/queries/stripe-refunds.queries";
import {
  STRIPE_REFUND_NOTES_MAX,
  type StripeRefundAmountRefusal,
  type StripeRefundFormValues,
  judgeStripeRefundAmount,
  stripeRefundFormSchema,
} from "@/lib/validators/validator.stripe-refund";

import { StripeRefundRepeatPrompt } from "./stripe-refund-repeat-prompt";
import { StripeRefundSummary } from "./stripe-refund-summary";
import { useReservationMoney } from "./use-reservation-money";
import { useStripeRefundRefusalText } from "./use-stripe-refund-refusal-text";
import {
  type StripeRefundRefusal,
  stripeRefundAttemptOf,
  stripeRefundFailureKey,
  stripeRefundKeyFor,
  stripeRefundOutcomeOf,
  stripeRefundSendFailure,
} from "./util.stripe-refund";

interface StripeRefundFormProps {
  preview: PreviewRefundOutput;
  reservationId: string;
  reservationStatus: string;
  customerName: string;
  onClose: () => void;
}

/** A new key for each attempt: what the platform replays a repeat of the same send by. */
const newAttemptKey = () => globalThis.crypto.randomUUID();

/**
 * The amount (the refundable remainder, or part of it), the reason and a note, then the
 * summary to confirm. One key per dialog opening and values: a double click, or a retry
 * of the same values here, replays. Beyond the dialog, the server keeps one refund per
 * intent: another refund of the payment in progress closes the dialog with where to look
 * (`REFUND_ALREADY_IN_PROGRESS`); the same amount as a recent refund is asked again here,
 * and only its button confirms it, for exactly the request refused: any change to the form
 * drops the warning and its confirmation (`REFUND_REPEAT_UNCONFIRMED`). Nothing about a refund is
 * kept in the browser. Only a refusal, which proves nothing was refunded, lets the person
 * send freely again; any other answer reads as an outcome to check in the history. The
 * dialog closes once a refund is returned, whatever its state, and the page's server parts
 * (the invoices and credit notes) are read again.
 */
export const StripeRefundForm = ({
  preview,
  reservationId,
  reservationStatus,
  customerName,
  onClose,
}: StripeRefundFormProps) => {
  const t = useTranslations("dashboard.reservations.payment");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();
  const router = useRouter();
  const money = useReservationMoney(preview.currency);
  const refusalText = useStripeRefundRefusalText();
  const refundMutation = useMutation(stripeRefundsMutations.refund());
  const attempt = useRef<{ attempt: string; key: string } | null>(null);
  const sending = useRef(false);
  const [refusal, setRefusal] = useState<StripeRefundRefusal | null>(null);
  /**
   * The request refused as the same amount as a recent refund: what its confirmation sends,
   * exactly as refused. Any change to the form drops it, with its warning.
   */
  const [refusedRepeat, setRefusedRepeat] = useState<RefundPaymentInput | null>(null);
  const { paymentId, currency } = preview;

  const refundableHundredths = hundredthsOf(preview.refundable);
  const decimals = currencyMinorDigits(currency) ?? 2;
  const judge = (raw: string) => judgeStripeRefundAmount(raw, currency, refundableHundredths);
  const amountMessage = (refusal: StripeRefundAmountRefusal) => {
    switch (refusal) {
      case "too_precise":
        return t("amountTooPrecise", { currency, decimals });
      case "currency_unsupported":
        return t("currencyNotSupported", { currency });
      case "exceeds_refundable":
        return t("stripeRefund.amountExceeds", { amount: money(preview.refundable) });
      case "amount_invalid":
        return t("stripeRefund.amountInvalid");
    }
  };
  /** What stays refundable after `amount`, in the currency's decimals. */
  const remainingAfter = (amount: string) =>
    decimalOfMinor(
      (refundableHundredths - hundredthsOf(amount)) / (decimals === 0 ? 100 : 1),
      currency,
    );

  /** The form's values as a request: the amount as the refund judges it. */
  const requestOf = (value: StripeRefundFormValues): RefundPaymentInput | null => {
    const verdict = judge(value.amount);
    if (!verdict.ok) return null;
    const notes = value.notes.trim();
    return { paymentId, amount: verdict.amount, reason: value.reason, ...(notes ? { notes } : {}) };
  };

  const send = async (input: RefundPaymentInput) => {
    if (sending.current) return;
    sending.current = true;
    const current = stripeRefundKeyFor(
      attempt.current,
      stripeRefundAttemptOf(input),
      newAttemptKey,
    );
    attempt.current = current;
    const analytics = {
      reservationId,
      reservationStatus,
      scope: hundredthsOf(input.amount) === refundableHundredths ? "full" : "partial",
      reason: input.reason ?? "requested_by_customer",
    } as const;
    setRefusal(null);
    setRefusedRepeat(null);
    let answer: RefundPaymentOutput;
    try {
      answer = await refundMutation.mutateAsync({ input, idempotencyKey: current.key });
    } catch (error) {
      const failure = stripeRefundSendFailure(error);
      // Refused, nothing was refunded: the next send is a new request. Otherwise a retry
      // here carries the same key, which tells what became of this one.
      if (failure.known) attempt.current = null;
      captureStripeRefundRequested({ ...analytics, outcome: stripeRefundOutcomeOf({ error }) });
      sending.current = false;
      if (failure.refusal.key === "alreadyInProgress") {
        onClose();
        toastManager.add({
          title: t("stripeRefund.toast.alreadyInProgress"),
          description: t("stripeRefund.toast.alreadyInProgressDescription"),
          type: "info",
        });
        void invalidateReservationAll(queryClient, reservationId);
        return;
      }
      setRefusal(failure.refusal);
      // Its confirmation sends this request again, and nothing else.
      if (failure.refusal.key === "repeatUnconfirmed") setRefusedRepeat(input);
      return;
    }
    const { refund } = answer;
    captureStripeRefundRequested({ ...analytics, outcome: stripeRefundOutcomeOf(refund) });
    onClose();
    if (refund.status === "succeeded") {
      toastManager.add({ title: t("stripeRefund.toast.succeeded"), type: "success" });
    } else if (refund.status === "pending") {
      toastManager.add({
        title: t("stripeRefund.toast.pending"),
        description: t("stripeRefund.toast.pendingDescription"),
        type: "info",
      });
    } else {
      toastManager.add({
        title: t("stripeRefund.toast.failed"),
        description: t(
          `stripeRefund.failures.${stripeRefundFailureKey(refund.failure?.code ?? "failed")}`,
        ),
        type: "error",
      });
    }
    void invalidateReservationAll(queryClient, reservationId);
    // The invoices and credit notes the page renders on the server.
    router.refresh();
  };

  const defaultValues: StripeRefundFormValues = {
    amount: preview.refundable,
    reason: "requested_by_customer",
    notes: "",
  };
  const form = useAppForm({
    defaultValues,
    // Live: the amount is checked as it is typed, by the refund's own rule.
    validators: {
      onChange: stripeRefundFormSchema({
        currency,
        refundableHundredths,
        amountMessage,
        notesTooLong: t("stripeRefund.noteTooLong", { max: STRIPE_REFUND_NOTES_MAX }),
      }),
    },
    // Another request than the one refused: its warning and its confirmation no longer apply.
    listeners: {
      onChange: () => {
        setRefusedRepeat(null);
        setRefusal((shown) => (shown?.key === "repeatUnconfirmed" ? null : shown));
      },
    },
    onSubmit: ({ value }) => {
      const input = requestOf(value);
      return input ? send(input) : undefined;
    },
  });

  const reasons = [
    { value: "requested_by_customer", label: t("stripeRefund.reasons.requested_by_customer") },
    { value: "duplicate", label: t("stripeRefund.reasons.duplicate") },
  ];

  return (
    <form.AppForm>
      {/* A column that shrinks to the dialog's height: the panel scrolls, the footer stays. */}
      <form.Form formName="stripe-refund" noValidate className="flex min-h-0 flex-col">
        <DialogPanel>
          <div className="space-y-4">
            {refusal?.key === "repeatUnconfirmed" && refusedRepeat ? (
              <StripeRefundRepeatPrompt
                refusal={refusal}
                disabled={refundMutation.isPending}
                onConfirm={() => void send({ ...refusedRepeat, confirmRepeat: true })}
              />
            ) : refusal ? (
              <Alert variant="error">
                <AlertCircleIcon />
                <AlertDescription>{refusalText(refusal)}</AlertDescription>
              </Alert>
            ) : null}
            <form.AppField name="amount">
              {(field) => (
                <field.Input
                  label={t("stripeRefund.amount")}
                  description={t("stripeRefund.amountHint", { amount: money(preview.refundable) })}
                  type="number"
                  inputMode="decimal"
                  min={decimals === 0 ? "1" : "0.01"}
                  max={preview.refundable}
                  step={decimals === 0 ? "1" : "0.01"}
                  suffix={currency}
                />
              )}
            </form.AppField>
            <form.AppField name="reason">
              {(field) => (
                <field.Select label={t("stripeRefund.reason")} items={reasons}>
                  {reasons.map((reason) => (
                    <SelectItem key={reason.value} value={reason.value} label={reason.label}>
                      {reason.label}
                    </SelectItem>
                  ))}
                </field.Select>
              )}
            </form.AppField>
            <form.AppField name="notes">
              {(field) => (
                <field.Textarea
                  label={t("stripeRefund.note")}
                  placeholder={t("stripeRefund.notePlaceholder")}
                  maxLength={STRIPE_REFUND_NOTES_MAX}
                  rows={2}
                  className="resize-none"
                />
              )}
            </form.AppField>
            <form.Subscribe selector={(state) => state.values.amount}>
              {(amount) => {
                const verdict = judge(amount);
                return (
                  <StripeRefundSummary
                    preview={preview}
                    customerName={customerName}
                    amount={verdict.ok ? verdict.amount : null}
                    remainingAfter={verdict.ok ? remainingAfter(verdict.amount) : null}
                  />
                );
              }}
            </form.Subscribe>
          </div>
        </DialogPanel>
        <DialogFooter>
          {/* Not while a send is out: its outcome must come back to this dialog. */}
          <Button
            type="button"
            variant="outline"
            disabled={refundMutation.isPending}
            onClick={onClose}
          >
            {tCommon("cancel")}
          </Button>
          <form.Subscribe selector={(state) => state.values.amount}>
            {(amount) => {
              const verdict = judge(amount);
              return (
                <form.SubscribeButton
                  variant="destructive"
                  disabled={!verdict.ok}
                  isPending={refundMutation.isPending}
                >
                  {verdict.ok
                    ? t("stripeRefund.confirm", { amount: money(verdict.amount) })
                    : t("stripeRefund.confirmNoAmount")}
                </form.SubscribeButton>
              );
            }}
          </form.Subscribe>
        </DialogFooter>
      </form.Form>
    </form.AppForm>
  );
};
