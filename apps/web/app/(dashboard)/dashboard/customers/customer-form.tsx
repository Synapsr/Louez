"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition, useState } from "react";
import { useTranslations } from "next-intl";
import { useStore } from "@tanstack/react-form";

import { Button, Label } from "@louez/ui";
import { Input } from "@louez/ui";
import { PhoneInput } from "@/components/ui/phone-input";
import { Switch } from "@louez/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";
import { customerSchema } from "@louez/validations";
import { createCustomer, updateCustomer } from "./actions";
import { useAppForm } from "@/hooks/form/form";
import { getFieldError } from "@/hooks/form/form-context";
import { RootError } from "@/components/form/root-error";
import { trackOpenReplayEvent } from "@/lib/openreplay/client";
import { openReplayEvents, type DashboardCreationSource } from "@/lib/openreplay/events";

interface Customer {
  id: string;
  customerType: "individual" | "business";
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  vatNumber: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string | null;
  notes: string | null;
  discountPercent?: number | null;
}

const DISCOUNT_PRESETS = [5, 10, 15, 20, 25, 30, 50] as const;

interface CustomerFormProps {
  customer?: Customer;
  openReplaySource?: DashboardCreationSource;
}

export const CustomerForm = ({ customer, openReplaySource = "direct" }: CustomerFormProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.customers.form");
  const tCommon = useTranslations("common");
  const tValidation = useTranslations("validation");
  const [isPending, startTransition] = useTransition();
  const isEditing = !!customer;
  const [rootError, setRootError] = useState<string | null>(null);
  const initialDiscount = customer?.discountPercent ?? 0;
  const [hasDiscount, setHasDiscount] = useState<boolean>(initialDiscount > 0);

  useEffect(() => {
    if (isEditing) {
      return;
    }

    trackOpenReplayEvent(openReplayEvents.dashboardCustomerCreationStarted, {
      journey: "customer_creation",
      step: "started",
      source: openReplaySource,
    });
  }, [isEditing, openReplaySource]);

  const form = useAppForm({
    defaultValues: {
      customerType: customer?.customerType || ("individual" as const),
      email: customer?.email || "",
      firstName: customer?.firstName || "",
      lastName: customer?.lastName || "",
      companyName: customer?.companyName || undefined,
      vatNumber: customer?.vatNumber || undefined,
      phone: customer?.phone || undefined,
      address: customer?.address || undefined,
      city: customer?.city || undefined,
      postalCode: customer?.postalCode || undefined,
      country: customer?.country || undefined,
      notes: customer?.notes || undefined,
      discountPercent: initialDiscount,
    },
    onSubmit: async ({ value }) => {
      setRootError(null);

      const normalizedValue = {
        ...value,
        discountPercent: hasDiscount
          ? Math.min(100, Math.max(0, Math.round(Number(value.discountPercent) || 0)))
          : 0,
      };

      // Validate with Zod
      const validation = customerSchema.safeParse(normalizedValue);
      if (!validation.success) {
        const firstError = validation.error.issues[0];
        if (firstError) {
          setRootError(
            firstError.message === "validation.invalidNip"
              ? tValidation("invalidNip")
              : firstError.message,
          );
        }
        return;
      }

      startTransition(async () => {
        const result = isEditing
          ? await updateCustomer(customer.id, validation.data)
          : await createCustomer(validation.data);

        if (result.error) {
          setRootError(result.error);
          return;
        }

        if (!isEditing) {
          trackOpenReplayEvent(openReplayEvents.dashboardCustomerCreationCompleted, {
            journey: "customer_creation",
            step: "completed",
            source: openReplaySource,
          });
        }

        if (isEditing) {
          router.push(`/dashboard/customers/${customer.id}`);
        } else {
          router.push("/dashboard/customers");
        }
      });
    },
  });

  const customerType = useStore(form.store, (s) => s.values.customerType);

  return (
    <form.AppForm>
      <form.Form className="space-y-6">
        <RootError error={rootError} />

        <Card>
          <CardHeader>
            <CardTitle>{t("personalInfo")}</CardTitle>
            <CardDescription>{t("personalInfoDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {/* Business customer toggle */}
            <form.Field name="customerType">
              {(field) => (
                <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <Label className="text-base">{t("businessCustomer")}</Label>
                    <p className="text-sm text-muted-foreground">
                      {t("businessCustomerDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={field.state.value === "business"}
                    onCheckedChange={(checked) => {
                      field.handleChange(checked ? "business" : "individual");
                      if (!checked) {
                        form.setFieldValue("companyName", undefined);
                        form.setFieldValue("vatNumber", undefined);
                      }
                    }}
                  />
                </div>
              )}
            </form.Field>

            {/* Company name - only shown for business customers */}
            {customerType === "business" && (
              <form.Field name="companyName">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t("companyName")} *</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      value={field.state.value || ""}
                      onChange={(e) => field.handleChange(e.target.value || undefined)}
                      onBlur={field.handleBlur}
                      placeholder={t("companyNamePlaceholder")}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm font-medium text-destructive">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            )}

            {customerType === "business" && (
              <form.Field name="vatNumber">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t("nipNumber")} *</Label>
                    <Input
                      id={field.name}
                      name={field.name}
                      inputMode="numeric"
                      autoComplete="off"
                      value={field.state.value || ""}
                      onChange={(e) => field.handleChange(e.target.value || undefined)}
                      onBlur={field.handleBlur}
                      placeholder={t("nipNumberPlaceholder")}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm font-medium text-destructive">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="firstName">
                {(field) => (
                  <field.Input
                    label={`${t("firstName")}${customerType === "individual" ? " *" : ""}`}
                    placeholder={t("firstNamePlaceholder")}
                  />
                )}
              </form.AppField>

              <form.AppField name="lastName">
                {(field) => (
                  <field.Input
                    label={`${t("lastName")}${customerType === "individual" ? " *" : ""}`}
                    placeholder={t("lastNamePlaceholder")}
                  />
                )}
              </form.AppField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="email">
                {(field) => (
                  <field.Input
                    label={t("email")}
                    type="email"
                    placeholder={t("emailPlaceholder")}
                  />
                )}
              </form.AppField>

              <form.Field name="phone">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>{t("phone")}</Label>
                    <PhoneInput
                      value={field.state.value || ""}
                      onChange={field.handleChange}
                      placeholder={t("phonePlaceholder")}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm font-medium text-destructive">
                        {getFieldError(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("addressSection")}</CardTitle>
            <CardDescription>{t("addressDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form.AppField name="address">
              {(field) => (
                <field.Input label={t("address")} placeholder={t("addressPlaceholder")} />
              )}
            </form.AppField>

            <div className="grid gap-4 sm:grid-cols-3">
              <form.AppField name="postalCode">
                {(field) => (
                  <field.Input label={t("postalCode")} placeholder={t("postalCodePlaceholder")} />
                )}
              </form.AppField>

              <form.AppField name="city">
                {(field) => <field.Input label={t("city")} placeholder={t("cityPlaceholder")} />}
              </form.AppField>

              <form.AppField name="country">
                {(field) => (
                  <field.CountrySelect
                    label={t("country")}
                    placeholder={t("selectCountry")}
                    allCountries
                  />
                )}
              </form.AppField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stały rabat klienta</CardTitle>
            <CardDescription>
              Nadaj klientowi stały rabat procentowy, który zostanie automatycznie naliczony przy
              podliczeniu zamówienia na etapie „Dokończ Rezerwację” → „Potwierdzenie”.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">Nadaj stały rabat</Label>
                <p className="text-sm text-muted-foreground">
                  Po włączeniu klient otrzyma określony rabat (%) od ceny zamówienia podczas
                  składania rezerwacji.
                </p>
              </div>
              <Switch
                checked={hasDiscount}
                onCheckedChange={(checked) => {
                  setHasDiscount(checked);
                  if (!checked) {
                    form.setFieldValue("discountPercent", 0);
                  } else if ((form.getFieldValue("discountPercent") ?? 0) === 0) {
                    form.setFieldValue("discountPercent", 10);
                  }
                }}
              />
            </div>

            {hasDiscount && (
              <form.Field name="discountPercent">
                {(field) => {
                  const currentPercent = Number(field.state.value ?? 0);
                  return (
                    <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                      <div className="space-y-2">
                        <Label htmlFor={field.name}>Wysokość rabatu (%)</Label>
                        <div className="flex max-w-xs items-center gap-2">
                          <div className="relative flex-1">
                            <Input
                              id={field.name}
                              name={field.name}
                              type="number"
                              min={1}
                              max={100}
                              step={1}
                              inputMode="numeric"
                              value={field.state.value ?? ""}
                              onChange={(e) => {
                                const raw = e.target.value;
                                if (raw === "") {
                                  field.handleChange(0);
                                  return;
                                }
                                const parsed = Math.min(
                                  100,
                                  Math.max(0, Math.round(Number(raw) || 0)),
                                );
                                field.handleChange(parsed);
                              }}
                              onBlur={field.handleBlur}
                              placeholder="np. 10"
                              className="pr-9"
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm font-medium text-muted-foreground">
                              %
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-xs text-muted-foreground">Szybki wybór:</span>
                        {DISCOUNT_PRESETS.map((preset) => (
                          <Button
                            key={preset}
                            type="button"
                            size="sm"
                            variant={currentPercent === preset ? "default" : "outline"}
                            className="h-7 px-2.5 text-xs"
                            onClick={() => field.handleChange(preset)}
                          >
                            {preset}%
                          </Button>
                        ))}
                      </div>

                      {currentPercent > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Klient zobaczy na etapie potwierdzenia informację o przypisanym z góry
                          rabacie <strong>-{currentPercent}%</strong> wraz z porównaniem ceny
                          regularnej oraz ceny po rabacie.
                        </p>
                      )}
                    </div>
                  );
                }}
              </form.Field>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("internalNotes")}</CardTitle>
            <CardDescription>{t("internalNotesDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form.AppField name="notes">
              {(field) => <field.Textarea placeholder={t("notesPlaceholder")} rows={4} />}
            </form.AppField>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {tCommon("cancel")}
          </Button>
          <Button type="submit" isPending={isPending}>
            {isEditing ? t("save") : t("createCustomer")}
          </Button>
        </div>
      </form.Form>
    </form.AppForm>
  );
};
