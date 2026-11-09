"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { AgentAssistantCard } from "@/components/agent-connections/agent-assistant-card";
import { apiErrorKey } from "@/lib/orpc/errors";
import { accountMutations } from "@/lib/queries/account.queries";

import { AGENT_ASSISTANT_NOTICE_ID } from "./util.agent-assistant";

interface AgentAssistantNoticeProps {
  mcpUrl: string;
  oauthAvailable: boolean;
}

/**
 * The home's offer to connect an AI assistant, closed for good by the user.
 * It stays until the close is saved: a failed save keeps it and says so.
 */
export const AgentAssistantNotice = ({ mcpUrl, oauthAvailable }: AgentAssistantNoticeProps) => {
  const tErrors = useTranslations("errors");
  const dismissal = useMutation({
    ...accountMutations.dismissNotice(),
    onError: (error) => {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
    },
  });
  if (dismissal.isSuccess) return null;
  return (
    <AgentAssistantCard
      mcpUrl={mcpUrl}
      oauthAvailable={oauthAvailable}
      onDismiss={() => dismissal.mutate({ noticeId: AGENT_ASSISTANT_NOTICE_ID })}
      dismissing={dismissal.isPending}
    />
  );
};
