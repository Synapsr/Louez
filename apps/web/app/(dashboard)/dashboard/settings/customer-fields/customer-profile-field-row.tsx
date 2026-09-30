"use client";

import { useTranslations } from "next-intl";

import type { CustomerProfileFieldVisibility } from "@louez/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@louez/ui";
import { cn } from "@louez/utils";

import type { CustomerProfileFieldKey } from "./customer-fields.types";
import { CustomerProfileFieldPreview } from "./customer-profile-field-preview";

interface CustomerProfileFieldRowProps {
  field: CustomerProfileFieldKey;
  visibility: CustomerProfileFieldVisibility;
  /** Social links can be shown or hidden, never required. */
  allowsRequired: boolean;
  onChange: (visibility: CustomerProfileFieldVisibility) => void;
}

const isVisibility = (value: unknown): value is CustomerProfileFieldVisibility =>
  value === "hidden" || value === "optional" || value === "required";

/**
 * A native profile field in the form, its visibility chosen on its own line:
 * the label keeps the room it needs, the choice sits at its end. Hidden, it
 * stays in place, greyed, so the owner can bring it back.
 */
export const CustomerProfileFieldRow = ({
  field,
  visibility,
  allowsRequired,
  onChange,
}: CustomerProfileFieldRowProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const hidden = visibility === "hidden";
  const label = t(`native.${field}`);
  const items = (
    allowsRequired
      ? (["hidden", "optional", "required"] as const)
      : (["hidden", "optional"] as const)
  ).map((value) => ({ value, label: t(`native.visibility.${value}`) }));
  const inputId = `profile-${field}`;

  return (
    <div className="flex items-start gap-1 py-3 ps-1 pe-1.5">
      <span aria-hidden className="w-6 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <p
            className={cn(
              "min-w-0 text-sm font-medium leading-snug",
              hidden && "text-muted-foreground",
            )}
          >
            {label}
            {visibility === "required" && " *"}
          </p>
          <Select
            items={items}
            value={visibility}
            onValueChange={(next) => {
              if (isVisibility(next)) onChange(next);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t("builder.profile.visibility", { field: label })}
              className="w-auto min-w-32 shrink-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value} label={item.label}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div inert className={cn("transition-opacity", hidden && "opacity-40")}>
          <CustomerProfileFieldPreview field={field} id={inputId} />
        </div>
        <p className="text-muted-foreground text-sm">
          {hidden ? t("builder.profile.hiddenNote") : t(`native.${field}Help`)}
        </p>
      </div>
    </div>
  );
};
