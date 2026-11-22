"use client";

import { ExternalLink, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { trackDemoStep } from "./track-demo-step";

/**
 * The strip above every page of a demo store's dashboard: says the store is
 * a demonstration, opens its storefront, and leads to the sign-up.
 */
export function DemoBanner({
  storefrontUrl,
  signupUrl,
}: {
  storefrontUrl: string;
  signupUrl: string;
}) {
  const t = useTranslations("demo.banner");

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-amber-950 sm:flex-row sm:items-center sm:justify-between dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="text-sm">
          <p className="font-semibold">{t("title")}</p>
          <p className="text-amber-900/80 dark:text-amber-100/80">{t("detail")}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          render={<a href={storefrontUrl} target="_blank" rel="noopener noreferrer" />}
          onClick={() => trackDemoStep("storefront_opened")}
        >
          {t("openStorefront")}
          <ExternalLink data-slot="icon" aria-hidden />
        </Button>
        <Button size="sm" render={<a href={signupUrl} />}>
          {t("signup")}
        </Button>
      </div>
    </div>
  );
}
