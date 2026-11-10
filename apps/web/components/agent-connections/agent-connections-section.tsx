"use client";

import { useTranslations } from "next-intl";

import { Skeleton } from "@louez/ui";
import { BotIcon } from "@louez/ui/icons";

import { EmptyState } from "@/components/ui/empty-state";

import { AgentConnectionEditDialog } from "./agent-connection-edit-dialog";
import { AgentConnectionRevokeDialog } from "./agent-connection-revoke-dialog";
import { AgentConnectionRow } from "./agent-connection-row";
import { useAgentConnections } from "./use-agent-connections";
import { shownClientName } from "./util.agent-client";

/**
 * "Agents connectés": the OAuth clients the user authorized, with their
 * terms; each can be changed or revoked here, never by the agent itself.
 */
export const AgentConnectionsSection = () => {
  const t = useTranslations("agentConnections");
  const {
    list,
    items,
    stores,
    editing,
    revoking,
    setEditingId,
    setRevokingId,
    update,
    revoke,
    pending,
  } = useAgentConnections();

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{t("list.title")}</h3>
        <p className="text-muted-foreground text-sm">{t("list.description")}</p>
      </div>

      {list.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-36 w-full rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={BotIcon}
          title={t("list.empty")}
          description={t("list.emptyDescription")}
          className="rounded-lg border py-10"
        />
      ) : (
        <div className="space-y-2">
          {items.map((connection) => (
            <AgentConnectionRow
              key={connection.id}
              connection={connection}
              pending={pending}
              onToggleConfirm={(confirmSensitive) =>
                update.mutate({ id: connection.id, confirmSensitive })
              }
              onEdit={() => setEditingId(connection.id)}
              onRevoke={() => setRevokingId(connection.id)}
            />
          ))}
        </div>
      )}

      {editing && (
        <AgentConnectionEditDialog
          connection={editing}
          stores={stores}
          pending={update.isPending}
          onSave={(terms) => update.mutate({ id: editing.id, ...terms })}
          onClose={() => setEditingId(null)}
        />
      )}
      {revoking && (
        <AgentConnectionRevokeDialog
          clientName={shownClientName(revoking.client)}
          pending={revoke.isPending}
          onConfirm={() => revoke.mutate({ id: revoking.id })}
          onClose={() => setRevokingId(null)}
        />
      )}
    </section>
  );
};
