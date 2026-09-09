"use client";

import { z } from "zod";
import { useState } from "react";
import { startOfDay } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { AccountCard } from "@/components/storefront/account/account-card";
import { useAppForm } from "@/hooks/form/form";
import { requestReturnDateChange } from "@/app/(storefront)/[slug]/account/reservations/[reservationId]/date-change-actions";
import {
  previewRentalExtension,
  confirmRentalExtension,
  cancelRentalExtension,
} from "@/app/(storefront)/[slug]/account/reservations/[reservationId]/extension-actions";
import type { DateChangeRequest } from "@/lib/reservations/util.date-change-request";
import type { ExtensionPreview, ExtensionAttempt } from "@/lib/reservations/extension.types";

interface ReturnDateRequestCardProps {
  storeSlug: string;
  reservationId: string;
  startDate: string;
  initialEndDate: string;
  timezone: string;
  eligible: boolean;
  request: DateChangeRequest | null;
  requestedDateLabel: string | null;
  extension?: Pick<
    ExtensionAttempt,
    "status" | "expiresMs" | "supplement" | "currency" | "requestedEndMs"
  > & { id: string };
}

export const ReturnDateRequestCard = ({
  storeSlug,
  reservationId,
  startDate,
  initialEndDate,
  timezone,
  eligible,
  request,
  requestedDateLabel,
  extension,
}: ReturnDateRequestCardProps) => {
  const t = useTranslations("storefront.account.extension");
  const tRequest = useTranslations("storefront.account.dateChange");
  const locale = useLocale();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [preview, setPreview] = useState<{ value: ExtensionPreview; endDate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const formatMoney = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency }).format(amount);
  const mutation = useMutation({
    mutationFn: async ({ endDate, confirm = false }: { endDate: string; confirm?: boolean }) => {
      setError(null);
      if (!confirm) {
        const result = await previewRentalExtension({ storeSlug, reservationId, endDate });
        if ("error" in result) throw new Error(result.error);
        setPreview({ value: result.preview, endDate });
        return;
      }
      if (preview?.value.mode === "manual") {
        const result = await requestReturnDateChange({
          storeSlug,
          reservationId,
          endDate,
          reason: "",
        });
        if ("error" in result) throw new Error("unexpected");
      } else {
        const result = await confirmRentalExtension({
          storeSlug,
          reservationId,
          endDate,
          expectedSupplement:
            preview?.value.mode === "automatic"
              ? preview.value.supplement
              : (extension?.supplement ?? 0),
        });
        if ("error" in result) throw new Error(result.error);
        if (result.status === "checkout" && "url" in result) {
          window.location.assign(result.url);
          return;
        }
      }
      setExpanded(false);
      setPreview(null);
      router.refresh();
    },
    onError: (value) => {
      setError(value.message);
      setPreview(null);
      router.refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (!extension) return;
      const result = await cancelRentalExtension({
        storeSlug,
        reservationId,
        extensionId: extension.id,
      });
      if ("error" in result) throw new Error(result.error);
    },
    onSuccess: () => router.refresh(),
    onError: () => setError("unexpected"),
  });
  const defaultValues: { endDate: Date | undefined } = {
    endDate: fromZonedTime(initialEndDate, timezone),
  };
  const form = useAppForm({
    defaultValues,
    validators: {
      onSubmit: z.object({ endDate: z.date({ error: t("errors.invalidDate") }) }),
    },
    onSubmit: async ({ value }) => {
      if (!value.endDate) return;
      await mutation
        .mutateAsync({
          endDate: formatInTimeZone(value.endDate, timezone, "yyyy-MM-dd'T'HH:mm"),
        })
        .catch(() => undefined);
    },
  });
  if (!eligible && !request && !extension) return null;
  const pending = request?.status === "pending";
  const checkout = extension?.status === "checkout" && extension.expiresMs > Date.now();
  const busy = mutation.isPending || cancel.isPending;
  const errorAlert = error ? (
    <p role="alert" className="text-sm text-destructive">
      {t.has(`errors.${error}`) ? t(`errors.${error}`) : t("errors.unexpected")}
    </p>
  ) : null;
  return (
    <AccountCard title={t("title")}>
      {extension && extension.status !== "cancelled" ? (
        <p role="status" className="rounded-lg bg-muted p-3 text-sm">
          {t(
            checkout
              ? "checkoutPending"
              : extension.status === "checkout"
                ? "expired"
                : extension.status,
          )}
        </p>
      ) : null}
      {request ? (
        <div className="rounded-lg bg-muted p-3 text-sm" role="status">
          <p className="font-medium">{tRequest(`status.${request.status}`)}</p>
          <p className="mt-1">{requestedDateLabel}</p>
        </div>
      ) : null}
      {checkout ? (
        <>
          <p className="text-sm">{formatMoney(extension.supplement, extension.currency)}</p>
          {errorAlert}
          <Button
            disabled={busy}
            onClick={() => {
              const date = new Date(extension.requestedEndMs);
              const parts = new Intl.DateTimeFormat("sv-SE", {
                timeZone: timezone,
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              })
                .format(date)
                .replace(" ", "T");
              mutation.mutate({ endDate: parts, confirm: true });
            }}
          >
            {t("resume")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => cancel.mutate()}>
            {t("cancel")}
          </Button>
        </>
      ) : pending ? (
        <p className="text-sm text-muted-foreground">{tRequest("pendingHelp")}</p>
      ) : eligible ? (
        <>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          {!expanded ? (
            <Button
              variant="outline"
              onClick={() => {
                setExpanded(true);
                setPreview(null);
              }}
            >
              {t("open")}
            </Button>
          ) : (
            <form.AppForm>
              <form.Form className="flex flex-col gap-4">
                <form.AppField
                  name="endDate"
                  listeners={{
                    onChange: () => {
                      setPreview(null);
                      setError(null);
                    },
                  }}
                >
                  {(field) => (
                    <field.ReservationDatePicker
                      fixedRangeStart={new Date(startDate)}
                      timezone={timezone}
                      disabledDates={(date) => date < startOfDay(new Date(initialEndDate))}
                      label={t("newEnd")}
                      disabled={busy}
                    />
                  )}
                </form.AppField>
                {preview ? (
                  <div className="space-y-2 rounded-lg bg-muted p-4 text-sm" aria-live="polite">
                    {preview.value.mode === "manual" ? (
                      <p>{t(`reasons.${preview.value.reason}`)}</p>
                    ) : (
                      <>
                        <p>
                          {t("supplement")}{" "}
                          <strong>
                            {formatMoney(preview.value.supplement, preview.value.currency)}
                          </strong>
                        </p>
                        <p className="text-muted-foreground">
                          {t("newTotal", {
                            amount: formatMoney(preview.value.total, preview.value.currency),
                          })}
                        </p>
                      </>
                    )}
                  </div>
                ) : null}
                <div className="flex flex-col gap-2">
                  {errorAlert}
                  {preview ? (
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => mutation.mutate({ endDate: preview.endDate, confirm: true })}
                    >
                      {busy
                        ? t("loading")
                        : preview.value.mode === "manual"
                          ? t("request")
                          : preview.value.supplement > 0
                            ? t("pay")
                            : t("confirm")}
                    </Button>
                  ) : (
                    <Button type="submit" disabled={busy}>
                      {busy ? t("loading") : t("check")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setExpanded(false);
                      setError(null);
                      setPreview(null);
                      form.reset(form.state.values);
                    }}
                  >
                    {t("close")}
                  </Button>
                </div>
              </form.Form>
            </form.AppForm>
          )}
        </>
      ) : null}
      {!checkout && !(eligible && !pending && expanded) ? errorAlert : null}
    </AccountCard>
  );
};
