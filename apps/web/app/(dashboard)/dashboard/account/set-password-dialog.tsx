"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  toastManager,
} from "@louez/ui";

import { useSetPasswordForm } from "./use-set-password-form";

export const SetPasswordDialog = () => {
  const t = useTranslations("dashboard.settings.accountSettings.signIn");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { form, rootError, reset } = useSetPasswordForm({
    onSuccess: () => {
      setOpen(false);
      toastManager.add({ title: t("passwordSetToast"), type: "success" });
      router.refresh();
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {t("setPassword")}
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t("setPasswordTitle")}</DialogTitle>
          <DialogDescription>{t("setPasswordDescription")}</DialogDescription>
        </DialogHeader>

        <form.AppForm>
          <form.Form className="contents" formName="account.set-password">
            <DialogPanel className="space-y-4">
              <form.AppField name="newPassword">
                {(field) => (
                  <field.Password
                    label={t("newPasswordLabel")}
                    autoComplete="new-password"
                    autoFocus
                    showRules
                  />
                )}
              </form.AppField>

              {rootError && (
                <p className="text-destructive text-sm" role="alert">
                  {rootError}
                </p>
              )}
            </DialogPanel>

            <DialogFooter>
              <DialogClose render={<Button type="button" variant="outline" />}>
                {t("cancel")}
              </DialogClose>
              <form.SubscribeButton>{t("setPasswordSubmit")}</form.SubscribeButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogPopup>
    </Dialog>
  );
};
