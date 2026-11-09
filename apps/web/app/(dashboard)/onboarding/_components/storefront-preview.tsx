"use client";

import { Lock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { usePublicEnv } from "@/components/shared/public-env-provider";

import { useOnboardingPreview } from "../_lib/preview-context";
import { rgba } from "../_lib/util.preview-color";
import { StorefrontPreviewProduct } from "./storefront-preview-product";

const SAMPLE_PRICES = [18, 32, 45] as const;
const PLACEHOLDER_SHAPES = ["circle-triangle", "triangle-circle", "square-circle"] as const;

export function StorefrontPreview() {
  const t = useTranslations("onboarding.preview");
  const tStore = useTranslations("onboarding.store");
  const { preview } = useOnboardingPreview();
  const { NEXT_PUBLIC_APP_DOMAIN: appDomain } = usePublicEnv();

  const isDark = preview.theme === "dark";
  const name = preview.storeName.trim();
  const slug = preview.slug.trim() || tStore("slugDefault");
  const initial = (name || "L").charAt(0).toUpperCase();
  const ctaLabel = preview.reservationMode === "payment" ? t("pay") : t("reserve");
  const format = useFormatter();
  // Sample prices: they only show the store's currency, never real products.
  const formatPrice = (amount: number) =>
    format.number(amount, {
      style: "currency",
      currency: preview.currency,
      maximumFractionDigits: 0,
    });

  const bar = isDark ? "bg-zinc-800" : "bg-zinc-200";

  return (
    <div className="bg-card shadow-overlay overflow-hidden rounded-2xl">
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
            {slug}.{appDomain}
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
              <img src={preview.logoUrl} alt="" className="size-7 shrink-0  object-contain" />
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
          {SAMPLE_PRICES.map((amount, index) => (
            <StorefrontPreviewProduct
              key={amount}
              isDark={isDark}
              primaryColor={preview.primaryColor}
              ctaLabel={ctaLabel}
              price={formatPrice(amount)}
              shape={PLACEHOLDER_SHAPES[index]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
