"use client";

import { useTranslations } from "next-intl";

import { Alert, AlertDescription, Card, CardContent } from "@louez/ui";
import { KeyIcon, LinkIcon, WarningIcon } from "@louez/ui/icons";

import { CopyButton } from "@/components/ui/copy-button";

interface ConnectAgentGuideProps {
  /** `<app>/api/mcp`. */
  mcpUrl: string;
  /** False on an instance without HTTPS: no OAuth, API keys only. */
  oauthAvailable: boolean;
}

/** How to connect an assistant: sign in through OAuth (Claude.ai, ChatGPT), or an API key. */
export const ConnectAgentGuide = ({ mcpUrl, oauthAvailable }: ConnectAgentGuideProps) => {
  const t = useTranslations("agentConnections.guide");
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
      </div>

      <div className="flex items-center gap-2 rounded-lg border p-2 ps-3">
        <code className="min-w-0 flex-1 truncate text-sm">{mcpUrl}</code>
        <CopyButton value={mcpUrl} variant="ghost" size="icon-sm" className="shrink-0" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <LinkIcon className="size-4 shrink-0" aria-hidden="true" />
              {t("oauthTitle")}
            </p>
            {oauthAvailable ? (
              <>
                <p className="text-muted-foreground text-sm">{t("oauthDescription")}</p>
                <ul className="text-muted-foreground list-disc space-y-1 ps-5 text-sm">
                  <li>{t("claudeSteps")}</li>
                  <li>{t("chatgptSteps")}</li>
                </ul>
              </>
            ) : (
              <Alert variant="warning">
                <WarningIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <AlertDescription>{t("oauthUnavailable")}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-2 py-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <KeyIcon className="size-4 shrink-0" aria-hidden="true" />
              {t("keyTitle")}
            </p>
            <p className="text-muted-foreground text-sm">{t("keyDescription")}</p>
          </CardContent>
        </Card>
      </div>
    </section>
  );
};
