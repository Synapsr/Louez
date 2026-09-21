"use client";

import { useControlsDisabled } from "@louez/ui";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";
import { CheckIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { parseHexInput } from "../util.online-store-form";

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

/** The hex value on the label's line (with the native picker), eight presets under it. */
export const PrimaryColorField = ({ value, onChange }: PrimaryColorFieldProps) => {
  const controlsDisabled = useControlsDisabled();
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
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="primary-color-hex" className="font-normal">
          {t("primaryColor")}
        </Label>
        <div className="flex h-8 w-28 shrink-0 items-center gap-1.5 rounded-lg border bg-background pr-2 pl-1">
          <input
            disabled={controlsDisabled}
            type="color"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            aria-label={t("customColor")}
            className="size-6 shrink-0 cursor-pointer overflow-hidden rounded-md border-0 bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md [&::-webkit-color-swatch]:border-0 [&::-moz-color-swatch]:rounded-md [&::-moz-color-swatch]:border-0"
          />
          <span aria-hidden className="text-muted-foreground text-xs">
            #
          </span>
          <input
            disabled={controlsDisabled}
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
            className="w-full min-w-0 bg-transparent font-mono text-xs uppercase outline-none"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESET_COLORS.map((color) => {
          const selected = value === color.value;
          return (
            <button
              disabled={controlsDisabled}
              key={color.value}
              type="button"
              onClick={() => onChange(color.value)}
              aria-label={t(`colors.${color.key}`)}
              aria-pressed={selected}
              className={cn(
                "flex size-7 items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                selected && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
              )}
              style={{ backgroundColor: color.value }}
            >
              {selected ? <CheckIcon aria-hidden className="size-3.5 text-white" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
};
