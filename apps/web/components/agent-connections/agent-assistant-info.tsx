"use client";

import { useTranslations } from "next-intl";

import { Button, Popover, PopoverDescription, PopoverPopup, PopoverTrigger } from "@louez/ui";
import { HelpCircleIcon } from "@louez/ui/icons";

/** The "?" of the assistant strip: what an assistant can do, in a popover. */
export const AgentAssistantInfo = () => {
  const t = useTranslations("agentConnections.assistantCard");
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("infoLabel")}
            className="text-muted-foreground -my-1 align-middle"
          />
        }
      >
        <HelpCircleIcon aria-hidden="true" />
      </PopoverTrigger>
      {/* The popup is a dialog: it takes the trigger's name. */}
      <PopoverPopup side="bottom" align="start" className="max-w-72" aria-label={t("infoLabel")}>
        <PopoverDescription className="p-1">{t("info")}</PopoverDescription>
      </PopoverPopup>
    </Popover>
  );
};
