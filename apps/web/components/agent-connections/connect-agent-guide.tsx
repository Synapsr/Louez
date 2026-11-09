"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription } from "@louez/ui";
import { ChatGptIcon, ClaudeIcon, GrokIcon, LeChatIcon, WarningIcon } from "@louez/ui/icons";

import { CopyButton } from "@/components/ui/copy-button";

import { ConnectAgentAssistant } from "./connect-agent-assistant";
import { ConnectAgentDevelopers } from "./connect-agent-developers";
import { claudeConnectorLink } from "./util.assistant-links";

interface ConnectAgentGuideProps {
  /** `<app>/api/mcp`. */
  mcpUrl: string;
  /** False on an instance without HTTPS: no OAuth, API keys only. */
  oauthAvailable: boolean;
  /** `page`: the MCP settings page, with its own heading. `dialog`: the dialog carries it. */
  variant?: "page" | "dialog";
}

/**
 * How to connect an AI assistant, for anyone: one action per assistant, the
 * address once, and the technical details folded away for developers.
 */
export const ConnectAgentGuide = ({
  mcpUrl,
  oauthAvailable,
  variant = "page",
}: ConnectAgentGuideProps) => {
  const t = useTranslations("agentConnections.guide");
  return (
    <section className="space-y-4">
      {variant === "page" && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">{t("title")}</h3>
          <p className="text-muted-foreground text-sm">{t("description")}</p>
        </div>
      )}

      {oauthAvailable ? (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            <ConnectAgentAssistant
              assistant="claude"
              name="Claude"
              Icon={ClaudeIcon}
              mcpUrl={mcpUrl}
              addLink={claudeConnectorLink(mcpUrl)}
            />
            <ConnectAgentAssistant
              assistant="chatgpt"
              name="ChatGPT"
              Icon={ChatGptIcon}
              mcpUrl={mcpUrl}
              startUrl="https://chatgpt.com/plugins"
            />
            <ConnectAgentAssistant
              assistant="grok"
              name="Grok"
              Icon={GrokIcon}
              mcpUrl={mcpUrl}
              startUrl="https://grok.com/connectors"
            />
            {/* Le Chat is called Vibe since August 2026. */}
            <ConnectAgentAssistant
              assistant="mistral"
              name="Mistral Vibe"
              Icon={LeChatIcon}
              mcpUrl={mcpUrl}
              startUrl="https://chat.mistral.ai"
            />
          </ul>
          <p className="text-muted-foreground text-sm">{t("whatHappens")}</p>
        </>
      ) : (
        <Alert variant="warning">
          <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <AlertDescription>{t("oauthUnavailable")}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t("addressLabel")}</p>
        <div className="flex items-center gap-2 rounded-lg border p-1 ps-3">
          <code className="min-w-0 flex-1 truncate text-sm">{mcpUrl}</code>
          <CopyButton
            value={mcpUrl}
            label={t("copy")}
            copiedLabel={t("copied")}
            variant="ghost"
            size="sm"
            className="shrink-0"
          />
        </div>
      </div>

      <ConnectAgentDevelopers
        mcpUrl={mcpUrl}
        oauthAvailable={oauthAvailable}
        defaultOpen={!oauthAvailable}
      />
    </section>
  );
};
