"use client";

import {
  Button,
  Checkbox,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Input,
  Label,
  toastManager,
} from "@louez/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, PenLine } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { invalidateReservationAll } from "@/lib/orpc/invalidation";
import { orpc } from "@/lib/orpc/react";

import { SignaturePad } from "./inspection/[type]/components/signature-pad";

interface ContractInStoreSignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reservationId: string;
  customerName: string;
}

/**
 * The customer reads the contract and signs it on the renter's device. The drawn
 * signature and the signer's name are printed on the contract instead of an IP
 * address, which would be the store's.
 */
export const ContractInStoreSignDialog = ({
  open,
  onOpenChange,
  reservationId,
  customerName,
}: ContractInStoreSignDialogProps) => {
  const t = useTranslations("dashboard.reservations.contract.signDialog");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const [signerName, setSignerName] = useState(customerName);
  const [signature, setSignature] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  const signMutation = useMutation(orpc.dashboard.reservations.signInStore.mutationOptions());

  const reset = () => {
    setSignerName(customerName);
    setSignature(null);
    setAccepted(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const canSubmit = !!signature && accepted && signerName.trim().length > 0;

  const handleSubmit = async () => {
    if (!signature || !canSubmit) return;
    try {
      await signMutation.mutateAsync({
        reservationId,
        signerName: signerName.trim(),
        signature,
      });
      await invalidateReservationAll(queryClient, reservationId);
      toastManager.add({ title: t("success"), type: "success" });
      handleOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : null;
      const alreadySigned = message === "errors.contractAlreadySigned";
      const notSignable = message === "errors.contractNotSignable";
      if (alreadySigned || notSignable) {
        await invalidateReservationAll(queryClient, reservationId);
        handleOpenChange(false);
      }
      toastManager.add({
        title: alreadySigned
          ? t("alreadySigned")
          : notSignable
            ? tErrors("contractNotSignable")
            : tErrors("generic"),
        type: "error",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PenLine className="h-5 w-5" />
            {t("title")}
          </DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="space-y-4">
            <Button
              variant="outline"
              className="w-full"
              render={
                <a
                  href={`/api/reservations/${reservationId}/contract`}
                  target="_blank"
                  rel="noopener noreferrer"
                />
              }
            >
              <ExternalLink data-slot="icon" />
              {t("viewContract")}
            </Button>

            <div className="space-y-2">
              <Label htmlFor="contract-signer-name">{t("signerName")}</Label>
              <Input
                id="contract-signer-name"
                value={signerName}
                onChange={(event) => setSignerName(event.target.value)}
                maxLength={255}
                autoComplete="off"
              />
            </div>

            <SignaturePad
              value={signature}
              onChange={setSignature}
              signerName={signerName}
              showConfirmation={false}
              disabled={signMutation.isPending}
            />

            <div className="flex items-start space-x-3">
              <Checkbox
                id="contract-acceptance"
                checked={accepted}
                onCheckedChange={(checked) => setAccepted(checked === true)}
              />
              <label
                htmlFor="contract-acceptance"
                className="text-sm text-muted-foreground leading-tight cursor-pointer"
              >
                {t("acceptance")}
              </label>
            </div>
          </div>
        </DialogPanel>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => handleOpenChange(false)} className="sm:flex-1">
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleSubmit}
            isPending={signMutation.isPending}
            disabled={!canSubmit}
            className="sm:flex-1"
          >
            {t("confirm")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
