"use client";

import { ArrowRight } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Badge,
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@louez/ui";

export const IGNORE_TARGET = "ignore";
export const CREATE_TARGET = "create";

export interface ImportTargetOption {
  value: string;
  label: string;
}

interface ImportColumnRowProps {
  column: string;
  samples: string[];
  target: string | null;
  /** Whether the target came from the automatic recognition and was left as is. */
  isSuggested: boolean;
  nativeOptions: ImportTargetOption[];
  customOptions: ImportTargetOption[];
  takenTargets: ReadonlySet<string>;
  canCreateField: boolean;
  onChange: (target: string | null) => void;
  onCreateField: () => void;
}

export const ImportColumnRow = ({
  column,
  samples,
  target,
  isSuggested,
  nativeOptions,
  customOptions,
  takenTargets,
  canCreateField,
  onChange,
  onCreateField,
}: ImportColumnRowProps) => {
  const t = useTranslations("dashboard.settings.import.columns");
  const items = [
    { value: IGNORE_TARGET, label: t("ignore") },
    ...nativeOptions,
    ...customOptions,
    { value: CREATE_TARGET, label: t("createField", { name: column }) },
  ];
  const isAvailable = (option: ImportTargetOption) =>
    option.value === target || !takenTargets.has(option.value);

  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{column}</p>
        <p className="text-muted-foreground truncate text-xs">
          {samples.length > 0 ? samples.join(" · ") : t("noSample")}
        </p>
      </div>
      <ArrowRight className="text-muted-foreground hidden size-4 sm:block" />
      <div className="flex min-w-0 items-center gap-2">
        <Select
          items={items}
          value={target ?? IGNORE_TARGET}
          onValueChange={(next) => {
            if (next === CREATE_TARGET) onCreateField();
            else onChange(!next || next === IGNORE_TARGET ? null : next);
          }}
        >
          <SelectTrigger className="min-w-0 flex-1" aria-label={t("target")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={IGNORE_TARGET} label={t("ignore")}>
              {t("ignore")}
            </SelectItem>
            <SelectSeparator />
            <SelectGroup>
              <SelectGroupLabel>{t("groupNative")}</SelectGroupLabel>
              {nativeOptions.filter(isAvailable).map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
            {customOptions.length > 0 && (
              <SelectGroup>
                <SelectGroupLabel>{t("groupCustom")}</SelectGroupLabel>
                {customOptions.filter(isAvailable).map((option) => (
                  <SelectItem key={option.value} value={option.value} label={option.label}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            )}
            {canCreateField && (
              <>
                <SelectSeparator />
                <SelectItem value={CREATE_TARGET} label={t("createField", { name: column })}>
                  {t("createField", { name: column })}
                </SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
        <Badge
          variant={target ? (isSuggested ? "success" : "secondary") : "warning"}
          size="sm"
          className="hidden shrink-0 md:inline-flex"
        >
          {target ? (isSuggested ? t("recognized") : t("target")) : t("toMap")}
        </Badge>
      </div>
    </li>
  );
};
