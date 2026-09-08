"use client";

import { useTranslations } from "next-intl";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Separator,
  Slider,
} from "@louez/ui";
import { ProductIcon } from "@louez/ui/icons";

import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { withForm } from "@/hooks/form/form";

import { appearanceFormOptions } from "./util.appearance-form";

/** What comes after the hero: the catalog's first screen and the discount badges. */
export const AppearanceCatalogSection = withForm({
  ...appearanceFormOptions,
  render: ({ form }) => {
    const t = useTranslations("dashboard.settings.appearanceSettings");

    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ProductIcon />
            {t("catalog.title")}
          </CardTitle>
          <CardDescription>{t("catalog.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <form.Field name="catalogBrowseMode">
            {(field) => (
              <div className="flex flex-col gap-2">
                <div>
                  <Label>{t("catalogBrowseMode.title")}</Label>
                  <p className="text-muted-foreground text-xs">
                    {t("catalogBrowseMode.description")}
                  </p>
                </div>
                <FormRadioCardGroup
                  value={field.state.value}
                  onChange={field.handleChange}
                  options={[
                    {
                      value: "products",
                      label: t("catalogBrowseMode.products"),
                      description: t("catalogBrowseMode.productsDescription"),
                    },
                    {
                      value: "categories",
                      label: t("catalogBrowseMode.categories"),
                      description: t("catalogBrowseMode.categoriesDescription"),
                    },
                  ]}
                  columns={1}
                  errors={field.state.meta.errors}
                />
              </div>
            )}
          </form.Field>

          <Separator />

          <form.AppField name="maxDiscountEnabled">
            {(enabledField) => (
              <div className="flex flex-col gap-3">
                <enabledField.Switch
                  label={t("maxDiscount.title")}
                  description={t("maxDiscount.description")}
                />
                {enabledField.state.value ? (
                  <form.Field name="maxDiscountPercent">
                    {(percentField) => (
                      <div className="flex flex-col gap-3 rounded-lg border p-4">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{t("maxDiscount.upTo")}</span>
                          <span className="font-medium tabular-nums">
                            {percentField.state.value}%
                          </span>
                        </div>
                        <Slider
                          value={[percentField.state.value]}
                          onValueChange={(value) =>
                            percentField.handleChange(Array.isArray(value) ? value[0] : value)
                          }
                          min={5}
                          max={100}
                          step={5}
                        />
                        <p className="text-muted-foreground text-xs">{t("maxDiscount.hint")}</p>
                      </div>
                    )}
                  </form.Field>
                ) : null}
              </div>
            )}
          </form.AppField>
        </CardContent>
      </Card>
    );
  },
});
