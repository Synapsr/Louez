"use client";

import { useId } from "react";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { ASSISTANTS, type Assistant } from "./util.assistants";

interface ConnectAgentPickerProps {
  onChoose: (assistant: Assistant) => void;
}

/** The first step: which assistant the user has, one tile each. */
export const ConnectAgentPicker = ({ onChoose }: ConnectAgentPickerProps) => {
  const t = useTranslations("agentConnections.guide");
  const labelId = useId();
  return (
    <div className="space-y-2">
      <p id={labelId} className="text-sm font-medium">
        {t("chooseAssistant")}
      </p>
      <ul aria-labelledby={labelId} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ASSISTANTS.map((assistant) => (
          <li key={assistant.key}>
            <Button
              variant="outline"
              data-assistant={assistant.key}
              onClick={() => onChoose(assistant)}
              className="h-auto w-full py-4 text-sm"
            >
              <span className="flex flex-col items-center gap-2">
                <span className="bg-background text-foreground flex size-10 items-center justify-center rounded-full border">
                  <assistant.Icon aria-hidden="true" className="size-5" />
                </span>
                {assistant.name}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
};
