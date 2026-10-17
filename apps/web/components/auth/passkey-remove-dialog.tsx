"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
  DialogTrigger,
  toastManager,
} from "@louez/ui";
import { passkeyMutations } from "@/lib/queries/passkey.queries";
import { PasskeyReauthenticate } from "./passkey-reauthenticate";
import { passkeyErrorKey } from "./util.passkey-errors";
import { rememberPasskey } from "./util.passkey-preferences";

export const PasskeyRemoveDialog = ({ id, lastPasskey }: { id: string; lastPasskey: boolean }) => {
  const t = useTranslations("auth.passkey");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    ...passkeyMutations.remove(),
    onSuccess: () => {
      if (lastPasskey) rememberPasskey(false);
      setOpen(false);
      toastManager.add({ title: t("settings.removed"), type: "success" });
      router.refresh();
    },
  });
  const errorKey = mutation.isError ? passkeyErrorKey(mutation.error) : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (mutation.isPending) return;
        setOpen(value);
        mutation.reset();
      }}
    >
      <DialogTrigger render={<Button variant="ghost" size="lg" />}>
        {t("settings.remove")}
      </DialogTrigger>
      <DialogPopup showCloseButton={!mutation.isPending}>
        <DialogHeader>
          <DialogTitle>{t("settings.removeTitle")}</DialogTitle>
          <DialogDescription>{t("settings.removeDescription")}</DialogDescription>
        </DialogHeader>
        {errorKey && (
          <DialogPanel className="space-y-3">
            <p className="text-destructive text-sm" role="alert">
              {t(errorKey)}
            </p>
            {errorKey === "errors.reauthenticate" && <PasskeyReauthenticate />}
          </DialogPanel>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            size="lg"
            onClick={() => setOpen(false)}
            disabled={mutation.isPending}
          >
            {t("settings.cancel")}
          </Button>
          <Button
            variant="destructive"
            size="lg"
            onClick={() => mutation.mutate(id)}
            isPending={mutation.isPending}
            disabled={mutation.isPending || errorKey === "errors.reauthenticate"}
          >
            {t("settings.remove")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
