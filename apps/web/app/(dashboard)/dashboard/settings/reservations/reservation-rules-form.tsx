"use client";

import { useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { revalidateLogic, useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

import type { StoreSettings } from "@louez/types";
import { toastManager } from "@louez/ui";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { RootError } from "@/components/form/root-error";
import { useAppForm } from "@/hooks/form/form";
import { getMaxRentalMinutes, getMinRentalMinutes } from "@/lib/utils/rental-duration";

import { updateReservationRules } from "../actions";
import { StoreSettingsRentalRulesSection } from "../components/store-settings-rental-rules-section";
import { StripeRequiredDialog } from "../components/stripe-required-dialog";
import { useStoreSettingsUnits } from "../hooks/use-store-settings-units";

const reservationRulesSchema = z.object({
  reservationMode: z.enum(["payment", "request"]),
  pendingBlocksAvailability: z.boolean(),
  automaticExtensions: z.boolean(),
  maxExtensionDays: z.number().int().min(1).max(365).nullable(),
  onlinePaymentDepositPercentage: z.number().int().min(10).max(100),
  minRentalMinutes: z.number().int().min(0),
  maxRentalMinutes: z.number().int().min(1).nullable(),
  advanceNoticeMinutes: z.number().int().min(0),
  turnoverBufferMinutes: z.number().int().min(0).max(10080),
  requireCustomerAddress: z.boolean(),
});

interface ReservationRulesFormProps {
  settings: StoreSettings | null;
  stripeChargesEnabled: boolean;
}

export const ReservationRulesForm = ({
  settings,
  stripeChargesEnabled,
}: ReservationRulesFormProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.settings");
  const [isPending, startTransition] = useTransition();
  const [isStripeRequiredDialogOpen, setIsStripeRequiredDialogOpen] = useState(false);
  const [rootError, setRootError] = useState<string | null>(null);

  const units = useStoreSettingsUnits({
    minRentalMinutes: getMinRentalMinutes(settings),
    advanceNoticeMinutes: settings?.advanceNoticeMinutes ?? 0,
  });

  const form = useAppForm({
    defaultValues: {
      reservationMode: settings?.reservationMode ?? "payment",
      pendingBlocksAvailability: settings?.pendingBlocksAvailability ?? true,
      automaticExtensions: settings?.automaticExtensions ?? true,
      maxExtensionDays: settings?.maxExtensionDays ?? null,
      onlinePaymentDepositPercentage: settings?.onlinePaymentDepositPercentage ?? 100,
      minRentalMinutes: getMinRentalMinutes(settings),
      maxRentalMinutes: getMaxRentalMinutes(settings),
      advanceNoticeMinutes: settings?.advanceNoticeMinutes ?? 1440,
      turnoverBufferMinutes: settings?.turnoverBufferMinutes ?? 0,
      requireCustomerAddress: settings?.requireCustomerAddress ?? false,
    },
    validators: { onSubmit: reservationRulesSchema },
    validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
    onSubmit: async ({ value }) => {
      setRootError(null);
      startTransition(async () => {
        const result = await updateReservationRules(value);
        if (result.error) {
          setRootError(result.error);
          return;
        }
        toastManager.add({ title: t("settingsSaved"), type: "success" });
        form.reset();
        router.refresh();
      });
    },
  });

  const isDirty = useStore(form.store, (state) => state.isDirty);
  const reservationMode = useStore(form.store, (state) => state.values.reservationMode);

  return (
    <div className="space-y-4 sm:space-y-6">
      <form.AppForm>
        <form.Form className="space-y-4 sm:space-y-6">
          <RootError error={rootError} />

          <StoreSettingsRentalRulesSection
            form={form}
            stripeChargesEnabled={stripeChargesEnabled}
            reservationMode={reservationMode}
            onStripeRequired={() => setIsStripeRequiredDialogOpen(true)}
            units={units}
          />

          <section className="space-y-4 rounded-xl border bg-card p-6">
            <form.AppField name="automaticExtensions">
              {(field) => (
                <field.Switch
                  label={t("extensions.title")}
                  description={t("extensions.description")}
                />
              )}
            </form.AppField>
            <form.AppField name="maxExtensionDays">
              {(field) => (
                <field.Input
                  type="number"
                  min={1}
                  max={365}
                  value={field.state.value ?? ""}
                  onChange={(event) =>
                    field.handleChange(
                      event.target.value === "" ? null : Number(event.target.value),
                    )
                  }
                  label={t("extensions.maxDays")}
                />
              )}
            </form.AppField>
          </section>

          <FloatingSaveBar isDirty={isDirty} isLoading={isPending} onReset={() => form.reset()} />
        </form.Form>
      </form.AppForm>

      <StripeRequiredDialog
        open={isStripeRequiredDialogOpen}
        onOpenChange={setIsStripeRequiredDialogOpen}
      />
    </div>
  );
};
