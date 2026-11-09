"use client";

import { useState } from "react";

import { AgentAssistantCard } from "@/components/agent-connections/agent-assistant-card";
import { dismissNotice } from "@/app/(dashboard)/dashboard/actions";

import { AGENT_ASSISTANT_NOTICE_ID } from "./util.agent-assistant";

interface AgentAssistantNoticeProps {
  mcpUrl: string;
  oauthAvailable: boolean;
}

/** The home's offer to connect an AI assistant, closed for good by the user. */
export const AgentAssistantNotice = ({ mcpUrl, oauthAvailable }: AgentAssistantNoticeProps) => {
  const [closedNow, setClosedNow] = useState(false);
  if (closedNow) return null;

  const handleDismiss = () => {
    // Hidden at once; a failed save only means it shows again on the next visit.
    setClosedNow(true);
    void dismissNotice(AGENT_ASSISTANT_NOTICE_ID);
  };

  return (
    <AgentAssistantCard mcpUrl={mcpUrl} oauthAvailable={oauthAvailable} onDismiss={handleDismiss} />
  );
};
