"use client";

import { useState } from "react";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

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
 * "Vous avez un assistant IA ?": a quiet offer to let Claude, ChatGPT and the
 * others set up and run the store, which opens the connect guide in a dialog.
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
        "bg-muted/40 ring-border flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl p-4 ring-1 ring-inset",
        className,
      )}
    >
      <AgentLogos />
      <div className="min-w-0 flex-1 basis-56 space-y-0.5">
        <p className="text-sm font-medium">{t("title")}</p>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>
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
