"use client";

import type { ReactNode } from "react";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger, Input, Label, Switch } from "@louez/ui";

import type { ProductFormComponentApi, ProductFormValues } from "../types";

/**
 * Deposit and VAT: set once, rarely revisited, so they stay folded under the
 * rates. The switch is bound by hand rather than through `field.Switch`, whose
 * full-width bordered card boxes its own label in a footer this compact.
 */
export function PricingSecondaryOptions({
  form,
  watchedValues,
  currencySymbol,
  storeTaxEnabled,
  storeTaxRate,
}: {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  currencySymbol: string;
  storeTaxEnabled: boolean;
  storeTaxRate?: number;
}) {
  const t = useTranslations("dashboard.products.form");
  const inherits = watchedValues.taxSettings?.inheritFromStore ?? true;

  return (
    <Collapsible className="border-t">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex w-full items-center gap-1.5 py-2.5 text-sm transition-colors">
        <ChevronDown className="h-4 w-4 transition-transform group-data-panel-open:rotate-180" />
        {t("depositAndVat")}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="grid gap-x-10 gap-y-5 pt-1 pb-2 sm:grid-cols-[auto_1fr]">
          <SecondaryField label={t("deposit")}>
            <div className="w-36">
              <form.AppField name="deposit">
                {(field) => (
                  <field.Input suffix={currencySymbol} placeholder={t("depositPlaceholder")} />
                )}
              </form.AppField>
            </div>
          </SecondaryField>

          {storeTaxEnabled && (
            <SecondaryField label={t("vatLabel")}>
              <div className="flex min-h-8.5 flex-wrap items-center gap-x-4 gap-y-2">
                <form.Field name="taxSettings.inheritFromStore">
                  {(field) => (
                    <Label className="flex cursor-pointer items-center gap-2.5 text-sm font-normal">
                      <Switch
                        checked={field.state.value ?? true}
                        onCheckedChange={(checked: boolean) => field.handleChange(checked)}
                      />
                      {t("inheritTaxDescription", { rate: storeTaxRate ?? 0 })}
                    </Label>
                  )}
                </form.Field>

                {!inherits && (
                  <form.Field name="taxSettings.customRate">
                    {(field) => (
                      <div className="relative w-24">
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="any"
                          placeholder="20"
                          className="pr-7"
                          aria-label={t("customTaxRate")}
                          value={field.state.value ?? ""}
                          onChange={(event) =>
                            field.handleChange(
                              event.target.value ? parseFloat(event.target.value) : undefined,
                            )
                          }
                          onBlur={field.handleBlur}
                        />
                        <span className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2.5 z-10 flex items-center text-xs">
                          %
                        </span>
                      </div>
                    )}
                  </form.Field>
                )}
              </div>
            </SecondaryField>
          )}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/** One caption over one control, so both columns sit on the same baseline. */
function SecondaryField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-muted-foreground block text-xs">{label}</span>
      {children}
    </div>
  );
}
