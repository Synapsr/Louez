"use client";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { toastManager } from "@louez/ui";

import { apiErrorKey } from "@/lib/orpc/errors";
import {
  agentConnectionsKey,
  agentConnectionsMutations,
  agentConnectionsQueries,
} from "@/lib/queries/agent-connections.queries";

/** The "Agents connectés" list: the connections, and the edit and revoke dialogs' state. */
export const useAgentConnections = () => {
  const t = useTranslations("agentConnections");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const list = useQuery(agentConnectionsQueries.list());
  const refresh = () => queryClient.invalidateQueries({ queryKey: agentConnectionsKey() });
  const onError = (error: Error) => {
    const key = apiErrorKey(error);
    toastManager.add({
      title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
      type: "error",
    });
  };

  const update = useMutation({
    ...agentConnectionsMutations.update(),
    onSuccess: () => {
      toastManager.add({ title: t("list.saved"), type: "success" });
      setEditingId(null);
      return refresh();
    },
    onError,
  });

  const revoke = useMutation({
    ...agentConnectionsMutations.revoke(),
    onSuccess: () => {
      toastManager.add({ title: t("list.revoked"), type: "success" });
      setRevokingId(null);
      return refresh();
    },
    onError,
  });

  const items = list.data?.items ?? [];
  return {
    list,
    items,
    stores: list.data?.stores ?? [],
    editing: items.find((item) => item.id === editingId) ?? null,
    revoking: items.find((item) => item.id === revokingId) ?? null,
    setEditingId,
    setRevokingId,
    update,
    revoke,
    pending: update.isPending || revoke.isPending,
  };
};
