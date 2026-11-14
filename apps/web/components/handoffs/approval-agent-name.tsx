import { useTranslations } from "next-intl";

import type { ApprovalAgent } from "@louez/api/services/approval-page";

import { AgentClientIdentity } from "@/components/agent-connections/agent-client-identity";

/** Who asks for an approval: an OAuth client as the consent page names it, or the API key by its name. */
export const ApprovalAgentName = ({ agent }: { agent: ApprovalAgent }) => {
  const t = useTranslations("handoff.operation_approval");
  if (agent.kind === "oauth" && agent.client) return <AgentClientIdentity client={agent.client} />;
  const name =
    agent.kind === "api_key"
      ? agent.name
        ? t("apiKey", { name: agent.name })
        : t("apiKeyUnnamed")
      : (agent.name ?? t("unnamedAgent"));
  return <p className="text-sm font-medium wrap-break-word">{name}</p>;
};
