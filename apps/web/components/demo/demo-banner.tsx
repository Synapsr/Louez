"use client";

import { ArrowUpRight } from "lucide-react";
import { useTranslations } from "next-intl";

import { trackDemoStep } from "./track-demo-step";

/**
 * The one-line bar across the top of a demo store's dashboard, above the
 * sidebar and the header, on every page: it is a demonstration, for how long,
 * a way to its storefront, and the sign-up. Narrow screens keep the sign-up.
 */
export function DemoBanner({
  storefrontUrl,
  signupUrl,
  hoursLeft,
}: {
  storefrontUrl: string;
  signupUrl: string;
  /** Whole hours before the store is erased; null when unknown. */
  hoursLeft: number | null;
}) {
  const t = useTranslations("demo.banner");
  const line =
    hoursLeft === null
      ? t("line")
      : hoursLeft < 1
        ? t("lineSoon")
        : t("lineHours", { hours: hoursLeft });

  return (
    <div
      role="region"
      aria-label={t("short")}
      className="relative z-30 flex h-10 shrink-0 items-center gap-3 border-b border-white/10 bg-neutral-950 px-3 text-white sm:px-4"
    >
      <p className="min-w-0 flex-1 truncate text-[13px] text-white/75">
        <span className="sm:hidden">{t("short")}</span>
        <span className="hidden sm:inline">{line}</span>
      </p>
      <a
        href={storefrontUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackDemoStep("storefront_opened")}
        className="hidden shrink-0 items-center gap-1 text-[13px] text-white/75 transition-colors hover:text-white md:inline-flex"
      >
        {t("openStorefront")}
        <ArrowUpRight className="size-3.5" aria-hidden />
      </a>
      <a
        href={signupUrl}
        className="inline-flex h-7 shrink-0 items-center rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <span className="sm:hidden">{t("signupShort")}</span>
        <span className="hidden sm:inline">{t("signup")}</span>
      </a>
    </div>
  );
}
