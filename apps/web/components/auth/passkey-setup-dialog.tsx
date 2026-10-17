"use client";

import { useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";
import { CheckIcon, FingerprintIcon, ShieldCheckIcon } from "@louez/ui/icons";
import { passkeyMutations } from "@/lib/queries/passkey.queries";
import { PasskeyReauthenticate } from "./passkey-reauthenticate";
import { passkeyErrorKey } from "./util.passkey-errors";

interface PasskeySetupDialogProps {
  open: boolean;
  email: string;
  onClose: (registered: boolean) => void;
}

export const PasskeySetupDialog = ({ open, email, onClose }: PasskeySetupDialogProps) => {
  const t = useTranslations("auth.passkey");
  const actionRef = useRef<HTMLButtonElement>(null);
  const mutation = useMutation(passkeyMutations.register());
  const errorKey = mutation.isError ? passkeyErrorKey(mutation.error) : null;
  const close = () => {
    if (mutation.isPending) return;
    onClose(mutation.isSuccess);
    mutation.reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close();
      }}
    >
      <DialogPopup
        className="sm:max-w-md"
        initialFocus={actionRef}
        showCloseButton={!mutation.isPending}
      >
        <DialogHeader className="items-center pt-8 text-center">
          <div
            className="bg-primary/10 text-primary mb-3 flex size-16 items-center justify-center rounded-2xl"
            aria-hidden="true"
          >
            {mutation.isSuccess ? (
              <CheckIcon className="size-8" />
            ) : (
              <FingerprintIcon className="size-8" />
            )}
          </div>
          <DialogTitle className="text-balance leading-tight">
            {t(mutation.isSuccess ? "setup.successTitle" : "setup.title")}
          </DialogTitle>
          <DialogDescription className="text-pretty leading-relaxed">
            {t(mutation.isSuccess ? "setup.successDescription" : "setup.description")}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="bg-muted/60 rounded-xl px-4 py-3 text-center">
            <p className="text-muted-foreground mb-1 text-xs">{t("setup.account")}</p>
            <p className="text-sm font-medium break-all">{email}</p>
          </div>
          {!mutation.isSuccess && (
            <p className="text-muted-foreground flex gap-2.5 text-pretty text-sm leading-relaxed">
              <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t("setup.privacy")}
            </p>
          )}
          {errorKey && (
            <p className="text-destructive text-sm" role="alert">
              {t(errorKey)}
            </p>
          )}
          {errorKey === "errors.reauthenticate" && <PasskeyReauthenticate />}
        </DialogPanel>
        <DialogFooter variant="bare" className="sm:flex-col-reverse">
          {!mutation.isSuccess && (
            <Button size="lg" variant="ghost" onClick={close} disabled={mutation.isPending}>
              {t("setup.later")}
            </Button>
          )}
          <Button
            ref={actionRef}
            size="xl"
            className="w-full"
            onClick={mutation.isSuccess ? close : () => mutation.mutate()}
            disabled={mutation.isPending || errorKey === "errors.reauthenticate"}
            isPending={mutation.isPending}
          >
            {t(
              mutation.isSuccess
                ? "setup.done"
                : mutation.isPending
                  ? "setup.waiting"
                  : "setup.enable",
            )}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
