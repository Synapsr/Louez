"use client";

import { CheckCircle2, Circle, Package } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Separator,
} from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import type { Category, ProductFormComponentApi, ProductFormValues } from "../types";

interface ProductFormSummaryPanelProps {
  form: ProductFormComponentApi;
  watchedValues: ProductFormValues;
  imagesPreviews: string[];
  selectedCategory: Category | undefined;
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
  selectedCategory,
  priceLabel,
  currency,
}: ProductFormSummaryPanelProps) {
  const t = useTranslations("dashboard.products.form");

  const basePrice = watchedValues.basePriceDuration?.price || watchedValues.price || "";
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
      label: t("baseRate"),
      done: isValidPrice(basePrice),
      required: true,
    },
    { key: "photos", label: t("photos"), done: imagesPreviews.length > 0 },
    { key: "description", label: t("description"), done: descriptionText.length > 0 },
    { key: "category", label: t("category"), done: Boolean(watchedValues.categoryId) },
    {
      key: "deposit",
      label: t("deposit"),
      done: isValidPrice(watchedValues.deposit ?? ""),
    },
  ];
  const doneCount = checklist.filter((item) => item.done).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("previewTitle")}</CardTitle>
        <CardDescription>{t("previewDescription")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Live product preview */}
        <div className="overflow-hidden rounded-lg border">
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
              <Package className="text-muted-foreground/60 h-10 w-10" />
            </div>
          )}
          <div className="space-y-1.5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold">
                  {watchedValues.name.trim() || t("noName")}
                </h3>
                {selectedCategory && (
                  <Badge variant="secondary" className="mt-1">
                    {selectedCategory.name}
                  </Badge>
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
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <Circle className="text-muted-foreground/40 h-4 w-4 shrink-0" />
                )}
                <span className={item.done ? "" : "text-muted-foreground"}>{item.label}</span>
                {item.required && !item.done && (
                  <Badge variant="outline" className="ml-auto h-5 px-1.5 text-[10px]">
                    {t("summary.required")}
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        </div>

        <Separator />

        {/* Publication status */}
        <form.Field name="status">
          {(field) => (
            <div className="space-y-2.5">
              <Label>{t("publication")}</Label>
              <RadioGroup
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value as ProductFormValues["status"])}
                className="gap-2"
              >
                <label
                  htmlFor="status-active"
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    field.state.value === "active"
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="active" id="status-active" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t("statusActive")}</span>
                      <Badge variant="default" className="h-5 px-1.5 text-[10px]">
                        {t("recommended")}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t("statusActiveDescription")}
                    </p>
                  </div>
                </label>

                <label
                  htmlFor="status-draft"
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                    field.state.value === "draft"
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <RadioGroupItem value="draft" id="status-draft" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{t("statusDraft")}</span>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {t("statusDraftDescription")}
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>
          )}
        </form.Field>
      </CardContent>
    </Card>
  );
}
