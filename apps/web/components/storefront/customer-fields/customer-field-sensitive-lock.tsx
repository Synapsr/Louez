"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { Tooltip, TooltipPopup, TooltipTrigger } from "@louez/ui";

import { useStore } from "@/contexts/store-context";

/**
 * Lock beside the label of a sensitive field. Its tooltip answers "why do they
 * need my ID number?" before the customer has to ask.
 */
export const CustomerFieldSensitiveLock = () => {
  const t = useTranslations("storefront.customerFields");
  const { storeName } = useStore();
  const note = t("sensitiveNote", { store: storeName });

  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label={note}
        className="-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Lock aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipPopup className="max-w-64">{note}</TooltipPopup>
    </Tooltip>
  );
};
