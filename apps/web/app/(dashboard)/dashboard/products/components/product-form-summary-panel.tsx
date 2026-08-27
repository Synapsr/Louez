"use client";

import { useTranslations } from "next-intl";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Radio,
  Separator,
} from "@louez/ui";
import { CheckCircleIcon, CircleIcon, EyeIcon, ProductIcon } from "@louez/ui/icons";
import { formatCurrency } from "@louez/utils";

import type { Category, ProductFormComponentApi, ProductFormValues } from "../types";

interface ProductFormSummaryPanelProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  imagesPreviews: string[];
  selectedCategories: Category[];
  priceLabel: string;
  currency: string;
}

interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  required?: boolean;
}

function isValidPrice(raw: string | undefined): boolean {
  const value = (raw ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return false;
  return Number.parseFloat(value) > 0;
}

export function ProductFormSummaryPanel({
  form,
  watchedValues,
  imagesPreviews,
  selectedCategories,
  priceLabel,
  currency,
}: ProductFormSummaryPanelProps) {
  const t = useTranslations("dashboard.products.form");

  // Fixed pricing owns the flat `price` field; base rate values linger in the
  // form state after a mode switch and must not leak into the preview.
  const isFixedPricing = watchedValues.pricingKind === "fixed";
  const basePrice = isFixedPricing
    ? watchedValues.price || ""
    : watchedValues.basePriceDuration?.price || watchedValues.price || "";
  const descriptionText = (watchedValues.description || "").replace(/<[^>]*>/g, "").trim();

  const checklist: ChecklistItem[] = [
    {
      key: "name",
      label: t("name"),
      done: watchedValues.name.trim().length >= 2,
      required: true,
    },
    {
      key: "price",
      label: isFixedPricing ? t("fixedPrice") : t("baseRate"),
      done: isValidPrice(basePrice),
      required: true,
    },
    { key: "photos", label: t("photos"), done: imagesPreviews.length > 0 },
    {
      key: "description",
      label: t("description"),
      done: descriptionText.length > 0,
    },
    {
      key: "category",
      label: t("categories"),
      done: (watchedValues.categoryIds?.length ?? 0) > 0,
    },
    {
      key: "deposit",
      label: t("deposit"),
      done: isValidPrice(watchedValues.deposit ?? ""),
    },
  ];
  const doneCount = checklist.filter((item) => item.done).length;
  const publicationOptions = [
    {
      value: "active",
      label: t("statusActive"),
      description: t("statusActiveDescription"),
      recommended: true,
    },
    {
      value: "draft",
      label: t("statusDraft"),
      description: t("statusDraftDescription"),
      recommended: false,
    },
  ] as const;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeIcon className="h-5 w-5 shrink-0" />
          {t("previewTitle")}
        </CardTitle>
        <CardDescription>{t("previewDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live product preview */}
        <div className="overflow-hidden rounded-lg border bg-background">
          {imagesPreviews.length > 0 ? (
            <div className="bg-muted relative aspect-[4/3]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagesPreviews[0]}
                alt={watchedValues.name}
                className="h-full w-full object-cover"
              />
            </div>
          ) : (
            <div className="bg-muted flex aspect-[4/3] items-center justify-center">
              <ProductIcon className="text-muted-foreground/60 h-10 w-10" />
            </div>
          )}
          <div className="space-y-1.5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">
                  {watchedValues.name.trim() || t("noName")}
                </h3>
                {selectedCategories.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {selectedCategories.map((category) => (
                      <Badge key={category.id} variant="expired">
                        {category.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold">
                  {formatCurrency(Number.parseFloat(basePrice.replace(",", ".")) || 0, currency)}
                </p>
                <p className="text-muted-foreground text-xs">{priceLabel}</p>
              </div>
            </div>
            {descriptionText && (
              <p className="text-muted-foreground line-clamp-2 text-xs">{descriptionText}</p>
            )}
          </div>
        </div>

        {/* Completeness checklist */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <Label>{t("summary.checklistTitle")}</Label>
            <span className="text-muted-foreground text-xs tabular-nums">
              {doneCount}/{checklist.length}
            </span>
          </div>
          <ul className="space-y-1.5">
            {checklist.map((item) => (
              <li key={item.key} className="flex items-center gap-2 text-sm">
                {item.done ? (
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <CircleIcon className="text-muted-foreground/40 h-4 w-4 shrink-0" />
                )}
                <span className={item.done ? "" : "text-muted-foreground"}>{item.label}</span>
                {item.required && !item.done && (
                  <Badge variant="review" className="ml-auto h-5 px-1.5 text-[10px]">
                    {t("summary.required")}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>

        <Separator />

        <form.Field name="status">
          {(field) => (
            <form.RadioGroup
              label={t("publication")}
              value={field.state.value}
              onValueChange={(value) => field.handleChange(value as ProductFormValues["status"])}
              className="gap-2"
            >
              {publicationOptions.map((option) => (
                <Label
                  key={option.value}
                  className="flex items-start gap-2 bg-background rounded-lg border p-3 hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-background"
                >
                  <Radio value={option.value} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{option.label}</p>
                      {option.recommended && (
                        <Badge variant="progress" className="h-5 px-1.5 text-[10px]">
                          {t("recommended")}
                        </Badge>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-1 text-xs">{option.description}</p>
                  </div>
                </Label>
              ))}
            </form.RadioGroup>
          )}
        </form.Field>
      </CardContent>
    </Card>
  );
}
