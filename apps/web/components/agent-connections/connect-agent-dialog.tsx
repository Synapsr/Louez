"use client";

import { useTranslations } from "next-intl";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@louez/ui";

import { ConnectAgentGuide } from "./connect-agent-guide";

interface ConnectAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mcpUrl: string;
  oauthAvailable: boolean;
}

/** The connect guide of the MCP settings page, opened where the user is. */
export const ConnectAgentDialog = ({
  open,
  onOpenChange,
  mcpUrl,
  oauthAvailable,
}: ConnectAgentDialogProps) => {
  const t = useTranslations("agentConnections.guide");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ConnectAgentGuide mcpUrl={mcpUrl} oauthAvailable={oauthAvailable} variant="dialog" />
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
};
