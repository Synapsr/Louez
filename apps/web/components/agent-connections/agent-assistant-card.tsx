"use client";

import { useState } from "react";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

import { AgentAssistantInfo } from "./agent-assistant-info";
import { AgentLogos } from "./agent-logos";
import { ConnectAgentDialog } from "./connect-agent-dialog";

interface AgentAssistantCardProps {
  mcpUrl: string;
  oauthAvailable: boolean;
  /** Shows a close button; the caller decides what closing means. */
  onDismiss?: () => void;
  /** The close is being saved: the button waits. */
  dismissing?: boolean;
  className?: string;
}

/**
 * A one-line strip offering to let Claude, ChatGPT and the others set up the
 * store: their marks, one sentence with a "?" that says more, and a button
 * that opens the connect guide in a dialog.
 */
export const AgentAssistantCard = ({
  mcpUrl,
  oauthAvailable,
  onDismiss,
  dismissing = false,
  className,
}: AgentAssistantCardProps) => {
  const t = useTranslations("agentConnections.assistantCard");
  const [guideOpen, setGuideOpen] = useState(false);
  return (
    <div
      className={cn(
        "bg-muted/40 ring-border flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl py-2 ps-3 pe-2 ring-1 ring-inset",
        className,
      )}
    >
      <AgentLogos />
      <p className="min-w-0 flex-1 basis-40 text-sm font-medium">
        {t("title")} <AgentAssistantInfo />
      </p>
      <div className="ms-auto flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={() => setGuideOpen(true)}>
          {t("action")}
        </Button>
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDismiss}
            disabled={dismissing}
            aria-label={t("dismiss")}
            title={t("dismiss")}
            className="text-muted-foreground"
          >
            <X />
          </Button>
        )}
      </div>
      <ConnectAgentDialog
        open={guideOpen}
        onOpenChange={setGuideOpen}
        mcpUrl={mcpUrl}
        oauthAvailable={oauthAvailable}
      />
    </div>
  );
};
