"use client";

import { useState, type ComponentType, type SVGProps } from "react";

import { useTranslations } from "next-intl";

import type { AgentClient } from "@louez/api/contracts/agent-connections";
import { Badge } from "@louez/ui";
import {
  BotIcon,
  ChatGptIcon,
  ClaudeIcon,
  CursorIcon,
  GrokIcon,
  ShieldCheckIcon,
  WarningIcon,
} from "@louez/ui/icons";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";

import { otherDeclaredName } from "./util.agent-client";

type AgentVendor = NonNullable<AgentClient["destination"]>["vendor"];

/** Each vendor's mark, bundled with the app: nothing is fetched for it. */
const VENDOR_ICONS: Record<AgentVendor, ComponentType<SVGProps<SVGSVGElement>>> = {
  cursor: CursorIcon,
  grok: GrokIcon,
  chatgpt: ChatGptIcon,
  claude: ClaudeIcon,
};

interface AgentClientIdentityProps {
  client: Pick<AgentClient, "name" | "declaredBy" | "verified" | "iconUrl" | "destination">;
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
 *
 * A client whose codes all go to one vendor (`destination`) is shown as that
 * vendor instead: its name and bundled mark, and a badge saying where the
 * code goes, since that is what is verified. The name the client declared
 * follows in small text when it says something else, attributed to who
 * declared it: it can name which of the vendor's products asks, and hiding
 * it would hide what the client claims to be, yet it never reads as checked.
 */
export const AgentClientIdentity = ({ client, size = "default" }: AgentClientIdentityProps) => {
  const t = useTranslations("agentConnections");
  // The URL that failed, so a new URL is tried again.
  const [failedIconUrl, setFailedIconUrl] = useState<string | null>(null);
  const iconUrl = client.iconUrl !== failedIconUrl ? client.iconUrl : null;
  const nameClassName = size === "large" ? "text-lg font-semibold" : "text-sm font-medium";

  if (client.destination) {
    const { vendor, name, domain } = client.destination;
    const VendorIcon = VENDOR_ICONS[vendor];
    const declaredName = otherDeclaredName(client);
    return (
      <div className="flex min-w-0 items-start gap-3">
        <DashboardIconTile accent="neutral">
          <VendorIcon className="text-foreground size-5" />
        </DashboardIconTile>
        <div className="min-w-0 space-y-1">
          <p className={nameClassName}>{name}</p>
          <Badge variant="success" className="gap-1">
            <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
            {t("verifiedDestination", { domain })}
          </Badge>
          {declaredName && (
            <p className="text-muted-foreground text-xs break-all">
              {client.declaredBy
                ? t("declaredNameBy", { origin: client.declaredBy, name: declaredName })
                : t("declaredNameByItself", { name: declaredName })}
            </p>
          )}
        </div>
      </div>
    );
  }

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
        <p className={nameClassName}>{client.name ?? t("unknownClient")}</p>
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
