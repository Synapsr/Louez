"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";
import { CheckIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { parseHexInput } from "./util.appearance-form";

interface PrimaryColorFieldProps {
  value: string;
  onChange: (next: string) => void;
}

const PRESET_COLORS = [
  { key: "blue", value: "#2563eb" },
  { key: "green", value: "#16a34a" },
  { key: "purple", value: "#9333ea" },
  { key: "red", value: "#dc2626" },
  { key: "orange", value: "#ea580c" },
  { key: "pink", value: "#db2777" },
  { key: "teal", value: "#0d9488" },
  { key: "indigo", value: "#4f46e5" },
] as const;

const toHexDigits = (color: string): string => color.replace("#", "").toUpperCase();

/** Eight presets, the native picker, and a hex input that accepts pasted values. */
export const PrimaryColorField = ({ value, onChange }: PrimaryColorFieldProps) => {
  const t = useTranslations("dashboard.settings.appearanceSettings");
  const [hexInput, setHexInput] = useState(() => toHexDigits(value));
  const [lastValue, setLastValue] = useState(value);

  // The colour changed from outside (preset, picker, reset): mirror it.
  if (value !== lastValue) {
    setLastValue(value);
    if (parseHexInput(hexInput) !== value) setHexInput(toHexDigits(value));
  }

  const handleHexChange = (raw: string) => {
    const next = raw.toUpperCase();
    setHexInput(next);
    const parsed = parseHexInput(next);
    if (parsed) onChange(parsed);
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor="primary-color-hex">{t("primaryColor")}</Label>
        <p className="text-muted-foreground text-xs">{t("primaryColorDescription")}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map((color) => {
          const selected = value === color.value;
          return (
            <button
              key={color.value}
              type="button"
              onClick={() => onChange(color.value)}
              aria-label={t(`colors.${color.key}`)}
              aria-pressed={selected}
              className={cn(
                "flex size-8 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected && "scale-110 ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: color.value }}
            >
              {selected ? <CheckIcon aria-hidden className="size-4 text-white" /> : null}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={t("customColor")}
          className="size-9 cursor-pointer overflow-hidden rounded-lg border p-0.5"
        />
        <div className="relative flex-1">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground text-sm">
            #
          </span>
          <input
            id="primary-color-hex"
            type="text"
            value={hexInput}
            onChange={(event) => handleHexChange(event.target.value)}
            onPaste={(event) => {
              event.preventDefault();
              handleHexChange(event.clipboardData.getData("text"));
            }}
            placeholder="2563EB"
            maxLength={7}
            spellCheck={false}
            className="h-9 w-full rounded-lg border bg-background pr-3 pl-7 font-mono text-sm uppercase"
          />
        </div>
      </div>
    </div>
  );
};
