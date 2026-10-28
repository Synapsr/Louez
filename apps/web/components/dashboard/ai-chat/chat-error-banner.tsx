"use client";

import { AlertCircle, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { useInstanceConfig } from "@/components/instance-provider";

interface ChatErrorBannerProps {
  message: string;
  /** Rate-limit / plan-gate errors get the softer tone and the upgrade CTA. */
  isLimitError: boolean;
  /** Called when the upgrade link is followed (e.g. to close the modal). */
  onUpgradeNavigate?: () => void;
  className?: string;
}

/**
 * The chat's error strip, shared by the modal and the full-page chat so both
 * surfaces answer a failed request with exactly the same voice: destructive
 * red for real failures, a neutral muted strip plus an upgrade button when the
 * merchant simply hit a plan limit.
 */
export const ChatErrorBanner = ({
  message,
  isLimitError,
  onUpgradeNavigate,
  className,
}: ChatErrorBannerProps) => {
  const t = useTranslations("dashboard.aiChat");
  // No plan to upgrade to on an instance that does not bill its stores.
  const { billingEnabled } = useInstanceConfig();

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs",
        isLimitError
          ? "bg-muted/50 text-foreground"
          : "border-destructive/20 bg-destructive/5 text-destructive",
        className,
      )}
    >
      <AlertCircle className={cn("size-3.5 shrink-0", isLimitError && "text-muted-foreground")} />
      <span className="flex-1">{message}</span>
      {isLimitError && billingEnabled && (
        <Button
          size="xs"
          className="shrink-0"
          render={<Link href="/dashboard/settings/subscription" onClick={onUpgradeNavigate} />}
        >
          {t("limits.upgrade")}
          <ArrowRight data-slot="icon" />
        </Button>
      )}
    </div>
  );
};
