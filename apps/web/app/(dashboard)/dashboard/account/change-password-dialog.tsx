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

import { useChangePasswordForm } from "./use-change-password-form";

export const ChangePasswordDialog = () => {
  const t = useTranslations("dashboard.settings.accountSettings");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const { form, rootError, reset } = useChangePasswordForm({
    onSuccess: () => {
      setOpen(false);
      toastManager.add({ title: t("signIn.passwordChangedToast"), type: "success" });
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
        {t("signIn.changePassword")}
      </DialogTrigger>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{t("changePassword")}</DialogTitle>
          <DialogDescription>{t("signIn.changePasswordDescription")}</DialogDescription>
        </DialogHeader>

        <form.AppForm>
          <form.Form className="contents" formName="account.change-password">
            <DialogPanel className="space-y-4">
              <form.AppField name="currentPassword">
                {(field) => (
                  <field.Password
                    label={t("signIn.currentPasswordLabel")}
                    autoComplete="current-password"
                    autoFocus
                  />
                )}
              </form.AppField>

              <form.AppField name="newPassword">
                {(field) => (
                  <field.Password
                    label={t("signIn.newPasswordLabel")}
                    autoComplete="new-password"
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
                {t("signIn.cancel")}
              </DialogClose>
              <form.SubscribeButton>{t("signIn.changePasswordSubmit")}</form.SubscribeButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogPopup>
    </Dialog>
  );
};
