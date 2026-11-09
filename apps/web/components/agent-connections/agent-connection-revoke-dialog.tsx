"use client";

import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@louez/ui";

interface AgentConnectionRevokeDialogProps {
  clientName: string | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export const AgentConnectionRevokeDialog = ({
  clientName,
  pending,
  onConfirm,
  onClose,
}: AgentConnectionRevokeDialogProps) => {
  const t = useTranslations("agentConnections");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {t("list.revokeTitle", { client: clientName ?? t("unknownClient") })}
          </DialogTitle>
          <DialogDescription>{t("list.revokeDescription")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("list.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending} isPending={pending}>
            {t("list.revokeConfirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
