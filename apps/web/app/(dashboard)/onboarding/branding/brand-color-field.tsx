"use client";

import { useState } from "react";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { toFullHexColor } from "../_lib/util.hex-color";

const PRESET_COLORS = [
  "#0066FF",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
] as const;

interface BrandColorFieldProps {
  value: string;
  onChange: (color: string) => void;
  onBlur: () => void;
}

/**
 * The store colour: eight presets, then a hex field to type a code quickly
 * and a picker for any other colour. The hex field keeps its own draft so a
 * half-typed code never reaches the form; it applies as soon as it is valid.
 */
export const BrandColorField = ({ value, onChange, onBlur }: BrandColorFieldProps) => {
  const t = useTranslations("onboarding.branding");
  // The code being typed; null while it simply mirrors the field.
  const [draft, setDraft] = useState<string | null>(null);
  const shownCode = draft ?? value.replace("#", "").toUpperCase();
  const isInvalid = draft !== null && draft.length > 0 && toFullHexColor(draft) === null;
  const isCustom = !PRESET_COLORS.some((preset) => preset.toLowerCase() === value.toLowerCase());

  const handleCodeChange = (raw: string) => {
    const code = raw.replace(/[^0-9a-fA-F]/g, "").slice(0, 6).toUpperCase();
    setDraft(code);
    const color = toFullHexColor(code);
    if (color) onChange(color);
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-8 gap-2">
        {PRESET_COLORS.map((color) => {
          const isSelected = value.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={isSelected}
              onClick={() => {
                setDraft(null);
                onChange(color);
              }}
              className={cn(
                "ease-lagon flex aspect-square max-w-11 items-center justify-center rounded-[11px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)] transition-[translate,box-shadow] duration-200 hover:-translate-y-0.5",
                isSelected && "outline-2 outline-offset-2 outline-solid",
              )}
              style={{ backgroundColor: color, outlineColor: color }}
            >
              <Check
                strokeWidth={3}
                className={cn(
                  "ease-lagon size-4 text-white transition-[opacity,scale] duration-200",
                  isSelected ? "scale-100 opacity-100" : "scale-60 opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>

      <div
        className={cn(
          "bg-card flex h-11 items-center gap-1 rounded-lg px-1.5 shadow-[inset_0_0_0_1px_var(--color-input)] transition-shadow focus-within:shadow-[inset_0_0_0_1.5px_var(--color-ring),0_0_0_3px_color-mix(in_oklch,var(--color-ring)_18%,transparent)]",
          isInvalid && "shadow-[inset_0_0_0_1.5px_var(--color-destructive)]",
        )}
      >
        <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] transition-colors duration-300" style={{ backgroundColor: value }}>
          <span className="sr-only">{t("customColor")}</span>
          <input
            type="color"
            value={value}
            onChange={(event) => {
              setDraft(null);
              onChange(event.target.value);
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
        <span className="text-muted-foreground ms-2 font-mono text-sm">#</span>
        <input
          value={shownCode}
          onChange={(event) => handleCodeChange(event.target.value)}
          onBlur={() => {
            setDraft(null);
            onBlur();
          }}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          aria-label={t("hexLabel")}
          aria-invalid={isInvalid}
          className="min-w-0 flex-1 bg-transparent font-mono text-sm tracking-wide uppercase outline-none"
        />
        <label
          className={cn(
            "bg-muted relative inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2.5 text-xs font-semibold",
            isCustom && "shadow-[inset_0_0_0_1.5px_var(--color-foreground)]",
          )}
        >
          <span
            aria-hidden
            className="size-3.5 rounded-full bg-[conic-gradient(#ef4444,#f59e0b,#84cc16,#10b981,#06b6d4,#0066ff,#8b5cf6,#ec4899,#ef4444)]"
          />
          {t("customColor")}
          <input
            type="color"
            value={value}
            tabIndex={-1}
            onChange={(event) => {
              setDraft(null);
              onChange(event.target.value);
            }}
            className="absolute inset-0 size-full cursor-pointer opacity-0"
          />
        </label>
      </div>
    </div>
  );
};
