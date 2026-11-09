import type { DismissibleNoticeId } from "@/lib/dashboard/dismissed-notices";

export const AGENT_ASSISTANT_NOTICE_ID = "agent-assistant" satisfies DismissibleNoticeId;

/**
 * Whether the home offers to connect an AI assistant: until the user closes
 * the offer, and never once an agent can act on the store.
 */
export const shouldOfferAgentAssistant = (input: {
  dismissedNoticeIds: readonly DismissibleNoticeId[];
  hasAgentConnection: boolean;
}): boolean =>
  !input.hasAgentConnection && !input.dismissedNoticeIds.includes(AGENT_ASSISTANT_NOTICE_ID);
