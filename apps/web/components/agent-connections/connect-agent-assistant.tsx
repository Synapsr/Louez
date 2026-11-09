"use client";

import type { ComponentType, SVGProps } from "react";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { OpenInNewIcon } from "@louez/ui/icons";

import { CopyButton } from "@/components/ui/copy-button";

export type AssistantKey = "claude" | "chatgpt" | "grok" | "mistral";

interface ConnectAgentAssistantProps {
  assistant: AssistantKey;
  /** The brand name, the same in every language. */
  name: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
  mcpUrl: string;
  /** Opens the assistant with Louez filled in; without it, the user copies the address. */
  addLink?: string;
  /** The assistant's page the first step opens, when it has one. */
  startUrl?: string;
}

// Every assistant's steps hold three lines.
const STEPS = ["step1", "step2", "step3"] as const;

/**
 * One assistant, one action: add Louez in a click where the assistant allows
 * it, copy the address otherwise, then the few steps that follow and who may
 * do them, in plain words.
 */
export const ConnectAgentAssistant = ({
  assistant,
  name,
  Icon,
  mcpUrl,
  addLink,
  startUrl,
}: ConnectAgentAssistantProps) => {
  const t = useTranslations("agentConnections.guide");
  return (
    <li className="space-y-3 rounded-xl border p-3" data-assistant={assistant}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="bg-background text-foreground flex size-8 shrink-0 items-center justify-center rounded-full border">
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm font-medium">{name}</p>
        {addLink ? (
          <Button size="sm" render={<a href={addLink} target="_blank" rel="noopener noreferrer" />}>
            {t("addTo", { name })}
            <OpenInNewIcon aria-hidden="true" />
          </Button>
        ) : (
          <CopyButton
            value={mcpUrl}
            label={t("copyAddress")}
            copiedLabel={t("addressCopied")}
            variant="outline"
            size="sm"
          />
        )}
      </div>
      <ol className="text-muted-foreground list-decimal space-y-1 ps-5 text-sm marker:text-xs">
        {STEPS.map((step) => (
          <li key={step}>
            {t.rich(`assistants.${assistant}.${step}`, {
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
      <p className="text-muted-foreground text-xs">{t(`assistants.${assistant}.note`)}</p>
    </li>
  );
};
