"use client";

import { useEffect, useRef, useState } from "react";

import { log } from "evlog/next/client";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { withVisitSource } from "@/lib/visibility/util.visit-source";

import { useVisibilityAnalytics, type VisibilityPlacement } from "./use-visibility-analytics";

const GOOGLE_BUSINESS_URL = "https://business.google.com/";
const COPIED_FEEDBACK_MS = 2000;

interface GoogleBusinessPanelProps {
  storeId: string;
  storeUrl: string;
  placement: VisibilityPlacement;
}

/**
 * How to put the booking link on the store's Google profile: the "Website"
 * field, which every category has, and "Bookings" where Google offers it.
 * The link is marked `via=google`, so the visits it brings are counted.
 */
export const GoogleBusinessPanel = ({ storeId, storeUrl, placement }: GoogleBusinessPanelProps) => {
  const t = useTranslations("dashboard.visibility.google");
  const analytics = useVisibilityAnalytics(storeId);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const link = withVisitSource(storeUrl, "google");

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      analytics.shareUsed(placement, "google", "store");
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch (error) {
      log.warn({ action: "visibility_google_copy_failed", error: String(error) });
    }
  };

  const steps = [t("step1"), t("step2"), t("step3")];

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm">
            <span className="bg-primary/10 text-primary flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
              {index + 1}
            </span>
            <span className="pt-0.5">{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="outline" className="sm:flex-1" onClick={() => void copy()}>
          {copied ? <Check /> : <Copy />}
          {copied ? t("copied") : t("copyLink")}
        </Button>
        <Button
          className="sm:flex-1"
          render={<a href={GOOGLE_BUSINESS_URL} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLink />
          {t("open")}
        </Button>
      </div>
    </div>
  );
};
