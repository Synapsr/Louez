"use client";

import type { ComponentType } from "react";

import { Check, ChevronRight, MapPin, QrCode, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import type { VisibilityStep, VisibilityStepKey } from "@louez/api/contracts/visibility";
import { Badge, Button } from "@louez/ui";
import { cn } from "@louez/utils";

const STEP_ICONS: Record<VisibilityStepKey, ComponentType<{ className?: string }>> = {
  share_contacts: Send,
  qr_poster: QrCode,
  google_business: MapPin,
};

interface VisibilityStepRowProps {
  step: VisibilityStep;
  index: number;
  onOpen: () => void;
}

/** One step of the guide: what it is, why, and its status or the button that opens its tool. */
export const VisibilityStepRow = ({ step, index, onOpen }: VisibilityStepRowProps) => {
  const t = useTranslations("dashboard.visibility");
  const Icon = STEP_ICONS[step.key];
  const decided = step.status !== "todo";

  return (
    <div className="flex items-start gap-3 p-4 sm:items-center sm:gap-4 sm:p-5">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-xl",
          step.status === "done"
            ? "bg-badge-success-background text-badge-success-foreground"
            : "bg-muted text-muted-foreground",
        )}
        aria-hidden
      >
        {step.status === "done" ? <Check className="size-5" /> : <Icon className="size-5" />}
      </span>
      {/* On a phone the action goes under the text, which keeps the full width. */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", decided && "text-muted-foreground")}>
            <span className="sr-only">{index + 1}. </span>
            {t(`steps.${step.key}.title`)}
          </p>
          <p className="text-muted-foreground text-sm">{t(`steps.${step.key}.description`)}</p>
        </div>
        {decided ? (
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant={step.status === "done" ? "success" : "tertiary"}>
              {t(`status.${step.status}`)}
            </Badge>
            <Button variant="ghost" size="icon-sm" aria-label={t("actions.open")} onClick={onOpen}>
              <ChevronRight />
            </Button>
          </div>
        ) : (
          <Button size="sm" className="shrink-0 self-start sm:self-center" onClick={onOpen}>
            {t("actions.start")}
          </Button>
        )}
      </div>
    </div>
  );
};
