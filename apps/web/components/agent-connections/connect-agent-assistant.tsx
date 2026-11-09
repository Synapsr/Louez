"use client";

import type { Ref } from "react";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { ArrowLeftIcon, OpenInNewIcon } from "@louez/ui/icons";

import { ConnectAgentAddress } from "./connect-agent-address";
import type { Assistant } from "./util.assistants";

interface ConnectAgentAssistantProps {
  assistant: Assistant;
  mcpUrl: string;
  onBack: () => void;
  /** The assistant's name takes the focus when this step opens. */
  headingRef?: Ref<HTMLHeadingElement>;
  /** `h4` under the page's own `h3`; `h3` in the dialog, under its title. */
  headingAs?: "h3" | "h4";
}

// Every assistant's steps hold three lines.
const STEPS = ["step1", "step2", "step3"] as const;

/**
 * The second step, for the assistant the user chose: add Louez in a click
 * where the assistant allows it, the address to paste otherwise, then the few
 * steps that follow and who may do them, in plain words.
 */
export const ConnectAgentAssistant = ({
  assistant: { key, name, Icon, addLink, startUrl },
  mcpUrl,
  onBack,
  headingRef,
  headingAs: Heading = "h3",
}: ConnectAgentAssistantProps) => {
  const t = useTranslations("agentConnections.guide");
  return (
    <div className="space-y-4" data-assistant={key}>
      <Button variant="ghost" size="sm" onClick={onBack} className="text-muted-foreground -ms-2.5">
        <ArrowLeftIcon aria-hidden="true" />
        {t("changeAssistant")}
      </Button>
      <div className="flex items-center gap-3">
        <span className="bg-background text-foreground flex size-8 shrink-0 items-center justify-center rounded-full border">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <Heading ref={headingRef} tabIndex={-1} className="text-sm font-medium outline-none">
          {name}
        </Heading>
      </div>
      {addLink ? (
        <Button render={<a href={addLink(mcpUrl)} target="_blank" rel="noopener noreferrer" />}>
          {t("addTo", { name })}
          <OpenInNewIcon aria-hidden="true" />
        </Button>
      ) : (
        <ConnectAgentAddress mcpUrl={mcpUrl} />
      )}
      <ol className="text-muted-foreground list-decimal space-y-1 ps-5 text-sm marker:text-xs">
        {STEPS.map((step) => (
          <li key={step}>
            {t.rich(`assistants.${key}.${step}`, {
              link: (chunks) => (
                <a
                  href={startUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-foreground font-medium underline underline-offset-4"
                >
                  {chunks}
                </a>
              ),
            })}
          </li>
        ))}
      </ol>
      <p className="text-muted-foreground text-xs">{t(`assistants.${key}.note`)}</p>
      <p className="text-muted-foreground text-sm">{t("whatHappens")}</p>
    </div>
  );
};
