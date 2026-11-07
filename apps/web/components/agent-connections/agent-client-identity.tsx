"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@louez/ui";
import { BotIcon, ShieldCheckIcon, WarningIcon } from "@louez/ui/icons";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

interface AgentClientIdentityProps {
  client: {
    name: string | null;
    declaredBy: string | null;
    verified: boolean;
  };
  size?: "default" | "large";
}

/**
 * Who an OAuth client says it is: the name it declared, and who declared it
 * (the host that serves its metadata document, or nobody for a client that
 * registered itself). "Vérifié" only for a client on Louez's own list. The
 * client's logo is not shown: it is an image from another site, chosen by
 * the client.
 */
export const AgentClientIdentity = ({ client, size = "default" }: AgentClientIdentityProps) => {
  const t = useTranslations("agentConnections");
  return (
    <div className="flex min-w-0 items-start gap-3">
      <DashboardIconTile icon={BotIcon} accent="primary" />
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
