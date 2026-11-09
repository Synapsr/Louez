"use client";

import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@louez/ui";
import { WarningIcon } from "@louez/ui/icons";

import { ConnectAgentAddress } from "./connect-agent-address";
import { ConnectAgentAssistant } from "./connect-agent-assistant";
import { ConnectAgentDevelopers } from "./connect-agent-developers";
import { ConnectAgentPicker } from "./connect-agent-picker";
import type { Assistant } from "./util.assistants";

interface ConnectAgentGuideProps {
  /** `<app>/api/mcp`. */
  mcpUrl: string;
  /** False on an instance without HTTPS: no OAuth, API keys only. */
  oauthAvailable: boolean;
  /** `page`: the MCP settings page, with its own heading. `dialog`: the dialog carries it. */
  variant?: "page" | "dialog";
}

/**
 * How to connect an AI assistant, for anyone, in two steps: pick the assistant
 * you use, then follow its steps alone. The technical details stay folded
 * away for developers under the first step.
 */
export const ConnectAgentGuide = ({
  mcpUrl,
  oauthAvailable,
  variant = "page",
}: ConnectAgentGuideProps) => {
  const t = useTranslations("agentConnections.guide");
  const [chosen, setChosen] = useState<Assistant | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Each step change moves the focus with it, so keyboard and screen reader
  // users land on the new step: its heading, or the tile they came from.
  const choose = (assistant: Assistant) => {
    flushSync(() => setChosen(assistant));
    headingRef.current?.focus();
  };
  const back = () => {
    const from = chosen?.key;
    flushSync(() => setChosen(null));
    sectionRef.current?.querySelector<HTMLElement>(`button[data-assistant="${from}"]`)?.focus();
  };

  return (
    <section ref={sectionRef} className="space-y-4">
      {variant === "page" && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
      )}

      {!oauthAvailable ? (
        <>
          <Alert variant="warning">
            <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <AlertDescription>{t("oauthUnavailable")}</AlertDescription>
          </Alert>
          <ConnectAgentAddress mcpUrl={mcpUrl} />
          <ConnectAgentDevelopers mcpUrl={mcpUrl} oauthAvailable={false} defaultOpen />
        </>
      ) : chosen ? (
        <ConnectAgentAssistant
          assistant={chosen}
          mcpUrl={mcpUrl}
          onBack={back}
          headingRef={headingRef}
          headingAs={variant === "page" ? "h4" : "h3"}
        />
      ) : (
        <>
          <ConnectAgentPicker onChoose={choose} />
          <ConnectAgentDevelopers mcpUrl={mcpUrl} oauthAvailable />
        </>
      )}
    </section>
  );
};
