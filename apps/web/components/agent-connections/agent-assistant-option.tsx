"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { AgentAssistantInfo } from "./agent-assistant-info";
import { AgentLogos } from "./agent-logos";
import { ConnectAgentDialog } from "./connect-agent-dialog";

interface AgentAssistantOptionProps {
  mcpUrl: string;
  oauthAvailable: boolean;
  /** The assistants' marks; left out where the space is narrow (the checklist). */
  showLogos?: boolean;
  className?: string;
}

/**
 * The AI assistant offer as a secondary option inside another step (the
 * first product card, the setup checklist): the same sentence as the strip
 * (agent-assistant-card.tsx), quieter, with no close of its own.
 */
export const AgentAssistantOption = ({
  mcpUrl,
  oauthAvailable,
  showLogos = true,
  className,
}: AgentAssistantOptionProps) => {
  const t = useTranslations("agentConnections.assistantCard");
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      {showLogos && <AgentLogos className="scale-90" />}
      <p className="text-muted-foreground min-w-0 flex-1 basis-40 text-sm">
        {t("title")} <AgentAssistantInfo />
      </p>
      <Button variant="outline" size="sm" className="ms-auto" onClick={() => setGuideOpen(true)}>
        {t("action")}
      </Button>
      <ConnectAgentDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        mcpUrl={mcpUrl}
        oauthAvailable={oauthAvailable}
      />
    </div>
  );
};
