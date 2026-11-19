"use client";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";

/** What the AI sources count, and what they cannot, folded under the figures. */
export const AiTrafficNote = () => {
  const t = useTranslations("dashboard.analytics.ai.note");
  return (
    <Collapsible>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-sm">
        {t("title")}
        <ChevronDown className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <ul className="text-muted-foreground list-disc space-y-1.5 pt-3 pl-5 text-sm">
          <li>{t("visits")}</li>
          <li>{t("bookings")}</li>
          <li>{t("minimum")}</li>
          <li>{t("crawls")}</li>
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  );
};
