"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { BotIcon, ShieldCheckIcon, WarningIcon } from "@louez/ui/icons";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

interface AgentClientIdentityProps {
  client: {
    name: string | null;
    declaredBy: string | null;
    verified: boolean;
    iconUrl: string | null;
  };
  size?: "default" | "large";
}

/**
 * Who an OAuth client says it is: the name it declared, and who declared it
 * (the host that serves its metadata document, or nobody for a client that
 * registered itself). "Vérifié" only for a client on Louez's own list.
 *
 * The tile shows the website icon of the host that declared the client,
 * served by Louez from its own origin (`iconUrl`), or a bot when it has none
 * or it fails to load. A client that registered itself keeps the bot: the
 * logo it declares is never shown, as it could copy another client's.
 */
export const AgentClientIdentity = ({ client, size = "default" }: AgentClientIdentityProps) => {
  const t = useTranslations("agentConnections");
  // The URL that failed, so a new URL is tried again.
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = client.iconUrl !== failedIconUrl ? client.iconUrl : null;
  return (
    <div className="flex min-w-0 items-start gap-3">
      {iconUrl ? (
        <DashboardIconTile accent="neutral">
          <img
            src={iconUrl}
            alt=""
            className="size-5 object-contain"
            onError={() => setFailedIconUrl(iconUrl)}
          />
        </DashboardIconTile>
      ) : (
        <DashboardIconTile icon={BotIcon} accent="primary" />
      )}
      <div className="min-w-0 space-y-1">
        <p className={size === "large" ? "text-lg font-semibold" : "text-sm font-medium"}>
          {client.name ?? t("unknownClient")}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground min-w-0 break-all">
            {client.declaredBy
              ? t("declaredBy", { origin: client.declaredBy })
              : t("declaredByItself")}
          </span>
          {client.verified ? (
            <Badge variant="success" className="gap-1">
              <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
              {t("verified")}
            </Badge>
          ) : (
            <Badge variant="warning" className="gap-1">
              <WarningIcon className="size-3.5" aria-hidden="true" />
              {t("unverified")}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
};
