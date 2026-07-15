"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { env } from "@/env";

import { useOnboardingPreview } from "../_lib/preview-context";

function parseHexColor(hex: string): [number, number, number] | null {
  const value = hex.replace("#", "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  return [
    parseInt(expanded.slice(0, 2), 16),
    parseInt(expanded.slice(2, 4), 16),
    parseInt(expanded.slice(4, 6), 16),
  ];
}

function rgba(hex: string, alpha: number): string {
  const rgb = parseHexColor(hex) ?? [0, 102, 255];
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function readableTextColor(hex: string): string {
  const rgb = parseHexColor(hex) ?? [0, 102, 255];
  const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return luminance > 170 ? "#09090b" : "#ffffff";
}

function ProductCard({
  isDark,
  primaryColor,
  ctaLabel,
  priceWidth,
}: {
  isDark: boolean;
  primaryColor: string;
  ctaLabel: string;
  priceWidth: string;
}) {
  const bar = isDark ? "bg-zinc-800" : "bg-zinc-200";
  const barSoft = isDark ? "bg-zinc-900" : "bg-zinc-100";

  return (
    <div
      className={cn(
        "space-y-3 rounded-xl border p-3 transition-colors duration-500",
        isDark ? "border-zinc-800 bg-zinc-950" : "border-zinc-200 bg-white",
      )}
    >
      <div className={cn("aspect-4/3 rounded-lg transition-colors duration-500", barSoft)} />
      <div className="space-y-2 px-0.5">
        <div className={cn("h-2.5 w-3/4 rounded-full transition-colors duration-500", bar)} />
        <div className={cn("h-2 rounded-full transition-colors duration-500", bar, priceWidth)} />
      </div>
      <div
        className="flex h-8 items-center justify-center rounded-lg text-xs font-medium transition-colors duration-500"
        style={{
          backgroundColor: primaryColor,
          color: readableTextColor(primaryColor),
        }}
      >
        {ctaLabel}
      </div>
    </div>
  );
}

export function StorefrontPreview() {
  const t = useTranslations("onboarding.preview");
  const tStore = useTranslations("onboarding.store");
  const { preview } = useOnboardingPreview();

  const isDark = preview.theme === "dark";
  const name = preview.storeName.trim();
  const slug = preview.slug.trim() || tStore("slugDefault");
  const initial = (name || "L").charAt(0).toUpperCase();
  const ctaLabel = preview.reservationMode === "payment" ? t("pay") : t("reserve");

  const bar = isDark ? "bg-zinc-800" : "bg-zinc-200";

  return (
    <div className="bg-card overflow-hidden rounded-2xl border shadow-xs">
      {/* Browser chrome — follows the theme picked during onboarding */}
      <div
        className={cn(
          "grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b px-4 py-2.5 transition-colors duration-500",
          isDark ? "border-zinc-800 bg-zinc-900" : "border-zinc-200 bg-zinc-100/80",
        )}
      >
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
        </div>

        <div
          className={cn(
            "flex h-6 min-w-0 items-center gap-1.5 rounded-full px-3 text-[11px] transition-colors duration-500",
            isDark ? "bg-zinc-800 text-zinc-400" : "border border-zinc-200 bg-white text-zinc-500",
          )}
        >
          <Lock className="size-2.5 shrink-0 opacity-60" />
          <span className="truncate">
            {slug}.{env.NEXT_PUBLIC_APP_DOMAIN}
          </span>
        </div>
        {/* <div className="ml-auto flex items-center gap-2">
          {preview.userName && (
            <span className="text-muted-foreground max-w-32 truncate text-[11px]">
              {preview.userName}
            </span>
          )}
          {preview.userImage ? (
            <img
              src={preview.userImage}
              alt=""
              className="size-6 shrink-0 rounded-full border object-cover"
            />
          ) : (
            <div className="relative size-6 shrink-0 overflow-hidden rounded-full border">
              <GradientAvatar seed={preview.userSeed} size={24} />
              {preview.userName && (
                <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white drop-shadow-sm">
                  {preview.userName.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          )}
        </div> */}
      </div>

      {/* Storefront viewport — follows the theme picked during onboarding */}
      <div className={cn("transition-colors duration-500", isDark ? "bg-zinc-950" : "bg-white")}>
        {/* Storefront header */}
        <div
          className={cn(
            "flex items-center justify-between border-b px-6 py-4 transition-colors duration-500",
            isDark ? "border-zinc-800" : "border-zinc-200",
          )}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            {preview.logoUrl ? (
              <img
                src={preview.logoUrl}
                alt=""
                className="size-7 shrink-0 rounded-md object-contain"
              />
            ) : (
              <div
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold transition-colors duration-500"
                style={{
                  backgroundColor: rgba(preview.primaryColor, 0.15),
                  color: preview.primaryColor,
                }}
              >
                {initial}
              </div>
            )}
            {name ? (
              <span
                className={cn(
                  "truncate text-sm font-semibold transition-colors duration-500",
                  isDark ? "text-zinc-100" : "text-zinc-900",
                )}
              >
                {name}
              </span>
            ) : (
              <span className={cn("h-3 w-24 rounded-full transition-colors duration-500", bar)} />
            )}
          </div>
          <div className="flex items-center gap-4">
            <span className={cn("h-2 w-10 rounded-full transition-colors duration-500", bar)} />
            <span className={cn("h-2 w-8 rounded-full transition-colors duration-500", bar)} />
            <span
              className="h-7 w-16 rounded-lg transition-colors duration-500"
              style={{ backgroundColor: rgba(preview.primaryColor, 0.9) }}
            />
          </div>
        </div>

        {/* Hero */}
        <div className="space-y-3 px-6 pt-8 pb-6">
          <div className={cn("h-4 w-2/5 rounded-full transition-colors duration-500", bar)} />
          <div
            className={cn(
              "h-2.5 w-3/5 rounded-full transition-colors duration-500",
              isDark ? "bg-zinc-900" : "bg-zinc-100",
            )}
          />
        </div>

        {/* Product grid */}
        <div className="grid grid-cols-3 gap-4 px-6 pb-8">
          <ProductCard
            isDark={isDark}
            primaryColor={preview.primaryColor}
            ctaLabel={ctaLabel}
            priceWidth="w-1/3"
          />
          <ProductCard
            isDark={isDark}
            primaryColor={preview.primaryColor}
            ctaLabel={ctaLabel}
            priceWidth="w-1/2"
          />
          <ProductCard
            isDark={isDark}
            primaryColor={preview.primaryColor}
            ctaLabel={ctaLabel}
            priceWidth="w-2/5"
          />
        </div>
      </div>
    </div>
  );
}
