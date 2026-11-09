"use client";

import { useFormatter, useTranslations } from "next-intl";

import type { AgentConnection } from "@louez/api/contracts/agent-connections";
import { Badge, Button, Card, CardContent, Label, Switch } from "@louez/ui";

import { AgentClientIdentity } from "./agent-client-identity";

interface AgentConnectionRowProps {
  connection: AgentConnection;
  onToggleConfirm: (confirmSensitive: boolean) => void;
  onEdit: () => void;
  onRevoke: () => void;
  pending: boolean;
}

export const AgentConnectionRow = ({
  connection,
  onToggleConfirm,
  onEdit,
  onRevoke,
  pending,
}: AgentConnectionRowProps) => {
  const t = useTranslations("agentConnections");
  const format = useFormatter();
  const date = (value: Date) => format.dateTime(new Date(value), { dateStyle: "medium" });
  const stores = connection.stores.all
    ? t("list.allStores")
    : connection.stores.items.map((store) => store.name).join(", ");

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <AgentClientIdentity client={connection.client} />
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={onEdit} disabled={pending}>
              {t("list.edit")}
            </Button>
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              size="sm"
              onClick={onRevoke}
              disabled={pending}
            >
              {t("list.revoke")}
            </Button>
          </div>
        </div>

        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-muted-foreground text-xs">{t("storesTitle")}</dt>
            <dd className="truncate">{stores}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs">{t("presetsTitle")}</dt>
            <dd>{t(`presets.${connection.preset}.label`)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground text-xs">{t("bundlesTitle")}</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {connection.bundles.map((bundle) => (
                <Badge key={bundle} variant="secondary">
                  {t(`bundles.${bundle}.label`)}
                </Badge>
              ))}
            </dd>
          </div>
        </dl>

        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
          <Label className="flex items-center gap-2 text-sm font-normal">
            <Switch
              checked={connection.confirmSensitive}
              disabled={pending}
              onCheckedChange={onToggleConfirm}
            />
            {t("confirm.label")}
          </Label>
          <p className="text-muted-foreground text-xs">
            {connection.lastActionAt
              ? t("list.lastAction", { date: date(connection.lastActionAt) })
              : t("list.noAction")}
            {" · "}
            {t("list.connectedOn", { date: date(connection.createdAt) })}
          </p>
        </div>
      </CardContent>
    </Card>
  );
};
