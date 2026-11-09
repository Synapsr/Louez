"use client";

import Link from "next/link";

import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@louez/ui";

import { CopyButton } from "@/components/ui/copy-button";

import { claudeCodeCommand, cursorInstallLink, vscodeInstallLink } from "./util.assistant-links";

interface ConnectAgentDevelopersProps {
  mcpUrl: string;
  oauthAvailable: boolean;
  /** Opens the panel at first: on an instance without OAuth, it is the only way in. */
  defaultOpen?: boolean;
}

/**
 * The technical side of connecting, folded away: what the address is, how it
 * signs in, API keys for scripts, and one-click installs for code tools.
 */
export const ConnectAgentDevelopers = ({
  mcpUrl,
  oauthAvailable,
  defaultOpen = false,
}: ConnectAgentDevelopersProps) => {
  const t = useTranslations("agentConnections.guide");
  const command = claudeCodeCommand(mcpUrl);
  return (
    <Collapsible defaultOpen={defaultOpen} className="border-t pt-3">
      <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring flex items-center gap-1.5 rounded-md text-sm font-medium outline-none focus-visible:ring-2">
        {t("developers.toggle")}
        <ChevronDown
          aria-hidden="true"
          className="size-4 -rotate-90 transition-transform duration-200 group-data-panel-open:rotate-0 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsiblePanel className="motion-reduce:transition-none">
        <div className="text-muted-foreground space-y-4 pt-3 text-sm">
          <p>{t(oauthAvailable ? "developers.server" : "developers.serverWithoutOAuth")}</p>
          <div className="space-y-1">
            <p className="text-foreground font-medium">{t("developers.apiKeyTitle")}</p>
            <p>{t("developers.apiKeyDescription")}</p>
            <Link
              href="/dashboard/settings/integrations/mcp#api-keys"
              className="text-foreground font-medium underline underline-offset-4"
            >
              {t("developers.apiKeyLink")}
            </Link>
          </div>
          {/* Code tools sign in through OAuth too: without it, only API keys work. */}
          {oauthAvailable && (
            <>
              <div className="space-y-1">
                <p className="text-foreground font-medium">Claude Code</p>
                <div className="bg-muted/50 flex items-center gap-2 rounded-lg border p-1 ps-3">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{command}</code>
                  <CopyButton
                    value={command}
                    label={t("copy")}
                    copiedLabel={t("copied")}
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-foreground font-medium">{t("developers.editorsTitle")}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={cursorInstallLink(mcpUrl)} />}
                  >
                    {t("addTo", { name: "Cursor" })}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    render={<a href={vscodeInstallLink(mcpUrl)} />}
                  >
                    {t("addTo", { name: "VS Code" })}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
};
