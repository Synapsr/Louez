"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { useStore } from "@tanstack/react-form";
import { Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { z } from "zod";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  Label,
  toastManager,
} from "@louez/ui";
import {
  AdminShieldIcon,
  FastPaymentIcon,
  PercentageIcon,
  PricingIcon,
  RewardIcon,
} from "@louez/ui/icons";

import { FloatingSaveBar } from "@/components/dashboard/floating-save-bar";
import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { RootError } from "@/components/form/root-error";
import { getFieldError } from "@/hooks/form/form-context";
import { useAppForm } from "@/hooks/form/form";
import { buildPayAsYouGoConfig } from "@/lib/pay-as-you-go/config";

import { updateAdminSettings } from "./actions";

type BillingMode = "subscription" | "pay_as_you_go";

const CURRENCY_SYMBOLS: Record<string, string> = { eur: "€", usd: "$" };

const tierSchema = z.object({
  id: z.string(),
  upToCount: z.number().int().positive().nullable(),
  priceEuros: z.number().min(0),
});

const adminSettingsSchema = z.object({
  trialDays: z.number().int().min(0).max(365),
  discountPercent: z.number().int().min(0).max(100),
  discountDurationMonths: z.number().int().min(0).max(120),
  billingMode: z.enum(["subscription", "pay_as_you_go"]),
  useFlatRate: z.boolean(),
  flatRateEuros: z.number().min(0),
  tiers: z.array(tierSchema),
  freeReservationsGranted: z.number().int().min(0).max(100000),
});

type AdminSettingsFormValues = z.infer<typeof adminSettingsSchema>;

interface AdminSettingsFormProps {
  trialDays: number;
  discountPercent: number;
  discountDurationMonths: number;
  billingMode: BillingMode;
  flatRateCents: number | null;
  tiers: { upToCount: number | null; priceCents: number }[];
  currency: string;
  freeReservationsGranted: number;
  freeReservationsRemaining: number;
}

export function AdminSettingsForm({
  trialDays,
  discountPercent,
  discountDurationMonths,
  billingMode,
  flatRateCents,
  tiers,
  currency,
  freeReservationsGranted,
  freeReservationsRemaining,
}: AdminSettingsFormProps) {
  const router = useRouter();
  const t = useTranslations("dashboard.settings.admin");
  const [isPending, startTransition] = useTransition();
  const [rootError, setRootError] = useState<string | null>(null);

  const symbol = CURRENCY_SYMBOLS[currency] ?? currency.toUpperCase();

  // The last saved values, initially the loaded ones (tier row ids are generated on mount,
  // not on every render). Kept in state so the form shows them after a save, and each
  // save is compared with them.
  const [saved, setSaved] = useState<AdminSettingsFormValues>(() => ({
    trialDays,
    discountPercent,
    discountDurationMonths,
    billingMode,
    useFlatRate: flatRateCents !== null,
    flatRateEuros: flatRateCents !== null ? flatRateCents / 100 : 0,
    tiers:
      tiers.length > 0
        ? tiers.map((tier) => ({
            id: crypto.randomUUID(),
            upToCount: tier.upToCount,
            priceEuros: tier.priceCents / 100,
          }))
        : [{ id: crypto.randomUUID(), upToCount: null, priceEuros: 0 }],
    freeReservationsGranted,
  }));

  const form = useAppForm({
    defaultValues: saved,
    validators: { onSubmit: adminSettingsSchema },
    onSubmit: async ({ value }) => {
      setRootError(null);
      const payAsYouGoConfig = buildPayAsYouGoConfig(value, currency);
      // The action only writes the billing fields that differ from the last saved values.
      const loaded = saved;

      startTransition(async () => {
        const result = await updateAdminSettings({
          trialDays: value.trialDays,
          discountPercent: value.discountPercent,
          discountDurationMonths: value.discountDurationMonths,
          billingMode: value.billingMode,
          payAsYouGoConfig,
          freeReservationsGranted: value.freeReservationsGranted,
          loaded: {
            billingMode: loaded.billingMode,
            payAsYouGoConfig: buildPayAsYouGoConfig(loaded, currency),
            freeReservationsGranted: loaded.freeReservationsGranted,
          },
        });
        if (result.error) {
          setRootError(result.error);
          return;
        }
        toastManager.add({ title: t("saved"), type: "success" });
        setSaved(value);
        form.reset(value);
        router.refresh();
      });
    },
  });

  const isDirty = useStore(form.store, (s) => s.isDirty);
  const useFlatRate = useStore(form.store, (s) => s.values.useFlatRate);
  const tierRows = useStore(form.store, (s) => s.values.tiers);

  return (
    <form.AppForm>
      <form.Form className="space-y-6">
        <RootError error={rootError} />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AdminShieldIcon className="h-5 w-5 shrink-0" />
              {t("trialSection")}
            </CardTitle>
            <CardDescription>{t("trialSectionDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form.Field name="trialDays">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t("trialDays")}</Label>
                  <InputGroup className="w-fit">
                    <InputGroupInput
                      id={field.name}
                      type="number"
                      min={0}
                      max={365}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      className="w-24 flex-none"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{t("days")}</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <p className="text-muted-foreground text-sm">{t("trialDaysDescription")}</p>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PercentageIcon className="h-5 w-5 shrink-0" />
              {t("discountSection")}
            </CardTitle>
            <CardDescription>{t("discountSectionDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form.Field name="discountPercent">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t("discountPercent")}</Label>
                  <InputGroup className="w-fit">
                    <InputGroupInput
                      id={field.name}
                      type="number"
                      min={0}
                      max={100}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      className="w-24 flex-none"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>%</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <p className="text-muted-foreground text-sm">{t("discountPercentDescription")}</p>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="discountDurationMonths">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t("discountDuration")}</Label>
                  <InputGroup className="w-fit">
                    <InputGroupInput
                      id={field.name}
                      type="number"
                      min={0}
                      max={120}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(parseInt(e.target.value) || 0)}
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      className="w-24 flex-none"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{t("months")}</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  <p className="text-muted-foreground text-sm">
                    {t("discountDurationDescription")}
                  </p>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <RewardIcon className="h-5 w-5 shrink-0" />
              {t("freeReservations.title")}
            </CardTitle>
            <CardDescription>{t("freeReservations.description")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form.Field name="freeReservationsGranted">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t("freeReservations.grantedLabel")}</Label>
                  <InputGroup className="w-fit">
                    <InputGroupInput
                      id={field.name}
                      type="number"
                      min={0}
                      step="1"
                      value={Number.isFinite(field.state.value) ? field.state.value : 0}
                      onChange={(e) =>
                        field.handleChange(
                          e.target.value === ""
                            ? 0
                            : Math.max(0, Math.round(Number(e.target.value))),
                        )
                      }
                      onBlur={field.handleBlur}
                      aria-invalid={field.state.meta.errors.length > 0}
                      className="w-32 flex-none"
                    />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{t("freeReservations.unit")}</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
            <p className="text-muted-foreground text-sm">
              {t("freeReservations.remaining", {
                remaining: freeReservationsRemaining,
                granted: freeReservationsGranted,
              })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FastPaymentIcon className="h-5 w-5 shrink-0" />
              {t("payAsYouGo.title")}
            </CardTitle>
            <CardDescription>{t("payAsYouGo.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form.Field name="billingMode">
              {(field) => (
                <FormRadioCardGroup
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={[
                    {
                      value: "subscription",
                      label: t("payAsYouGo.modeSubscription"),
                      description: t("payAsYouGo.modeSubscriptionDescription"),
                    },
                    {
                      value: "pay_as_you_go",
                      label: t("payAsYouGo.modePayAsYouGo"),
                      description: t("payAsYouGo.modePayAsYouGoDescription"),
                    },
                  ]}
                  columns={1}
                />
              )}
            </form.Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PricingIcon className="h-5 w-5 shrink-0" />
              {t("payAsYouGo.pricingTitle")}
            </CardTitle>
            <CardDescription>{t("payAsYouGo.pricingDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Flat lifetime rate (exclusive offer) */}
            <form.AppField name="useFlatRate">
              {(field) => (
                <field.Switch
                  label={t("payAsYouGo.flatRateLabel")}
                  description={t("payAsYouGo.flatRateDescription")}
                />
              )}
            </form.AppField>

            {useFlatRate ? (
              <form.Field name="flatRateEuros">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor="payg-flat-rate">{t("payAsYouGo.flatRatePrice")}</Label>
                    <InputGroup className="w-fit">
                      <InputGroupInput
                        id="payg-flat-rate"
                        type="number"
                        min={0}
                        step="0.01"
                        value={Number.isFinite(field.state.value) ? field.state.value : 0}
                        onChange={(e) =>
                          field.handleChange(e.target.value === "" ? 0 : Number(e.target.value))
                        }
                        className="w-32 flex-none"
                      />
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>
                          {symbol} {t("payAsYouGo.perLocation")}
                        </InputGroupText>
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                )}
              </form.Field>
            ) : (
              <div className="space-y-3">
                <Label>{t("payAsYouGo.tiersLabel")}</Label>
                <p className="text-muted-foreground text-sm">{t("payAsYouGo.tiersDescription")}</p>
                <div className="space-y-2">
                  {tierRows.map((row, index) => (
                    <div key={row.id} className="flex items-end gap-2">
                      <form.Field name={`tiers[${index}].upToCount`}>
                        {(field) => (
                          <div className="grid gap-1">
                            <span className="text-muted-foreground text-xs">
                              {t("payAsYouGo.tierUpTo")}
                            </span>
                            <Input
                              type="number"
                              min={1}
                              placeholder={t("payAsYouGo.tierUnlimited")}
                              value={
                                field.state.value === null || field.state.value === undefined
                                  ? ""
                                  : field.state.value
                              }
                              onChange={(e) =>
                                field.handleChange(
                                  e.target.value === ""
                                    ? null
                                    : Math.max(1, Math.round(Number(e.target.value))),
                                )
                              }
                              className="w-32"
                            />
                          </div>
                        )}
                      </form.Field>
                      <form.Field name={`tiers[${index}].priceEuros`}>
                        {(field) => (
                          <div className="grid gap-1">
                            <span className="text-muted-foreground text-xs">
                              {t("payAsYouGo.tierPrice")} ({symbol})
                            </span>
                            <Input
                              type="number"
                              min={0}
                              step="0.01"
                              value={Number.isFinite(field.state.value) ? field.state.value : 0}
                              onChange={(e) =>
                                field.handleChange(
                                  e.target.value === "" ? 0 : Number(e.target.value),
                                )
                              }
                              className="w-28"
                            />
                          </div>
                        )}
                      </form.Field>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => form.removeFieldValue("tiers", index)}
                        disabled={tierRows.length <= 1}
                        aria-label={t("payAsYouGo.tierRemove")}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      {index === tierRows.length - 1 &&
                        (row.upToCount === null || row.upToCount === undefined) && (
                          <span className="text-muted-foreground pb-2 text-xs">
                            {t("payAsYouGo.tierAndAbove")}
                          </span>
                        )}
                    </div>
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    form.pushFieldValue("tiers", {
                      id: crypto.randomUUID(),
                      upToCount: null,
                      priceEuros: 0,
                    })
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t("payAsYouGo.tierAdd")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <FloatingSaveBar isDirty={isDirty} isLoading={isPending} onReset={() => form.reset()} />
      </form.Form>
    </form.AppForm>
  );
}
