"use client";

import { useState } from "react";

import { useTranslations } from "next-intl";

import type { AgentConnection } from "@louez/api/contracts/agent-connections";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "@louez/ui";

import { AgentTermsFields } from "./agent-terms-fields";
import { isAgentTermsComplete, type AgentTerms } from "./util.agent-terms";

interface AgentConnectionEditDialogProps {
  connection: AgentConnection;
  stores: ReadonlyArray<{ id: string; name: string; role: "owner" | "member" }>;
  pending: boolean;
  onSave: (terms: AgentTerms) => void;
  onClose: () => void;
}

const termsOf = (connection: AgentConnection): AgentTerms => ({
  stores: connection.stores.all
    ? { all: true }
    : { all: false, ids: connection.stores.items.map((store) => store.id) },
  preset: connection.preset,
  confirmSensitive: connection.confirmSensitive,
  bundles: connection.bundles,
});

/** Changes what a connected agent may do: its stores, rights, confirmation and tools. */
export const AgentConnectionEditDialog = ({
  connection,
  stores,
  pending,
  onSave,
  onClose,
}: AgentConnectionEditDialogProps) => {
  const t = useTranslations("agentConnections");
  const [terms, setTerms] = useState<AgentTerms>(() => termsOf(connection));
  const clientName = connection.client.name ?? t("unknownClient");

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("list.editTitle", { client: clientName })}</DialogTitle>
          <DialogDescription>{t("list.editDescription")}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <AgentTermsFields stores={stores} value={terms} onChange={setTerms} disabled={pending} />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("list.cancel")}
          </Button>
          <Button
            onClick={() => onSave(terms)}
            disabled={pending || !isAgentTermsComplete(terms)}
            isPending={pending}
          >
            {t("list.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
