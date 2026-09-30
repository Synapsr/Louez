"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { authClient } from "@louez/auth/client";
import { Button, toastManager } from "@louez/ui";

const ACCOUNT_PAGE_PATH = "/dashboard/account";

export const LinkGoogleButton = () => {
  const t = useTranslations("dashboard.settings.accountSettings.signIn");

  // On success the browser leaves for Google and comes back to this page;
  // a refused link comes back with `?error=`, which the page reports.
  const linkMutation = useMutation({
    mutationFn: async () => {
      const result = await authClient.linkSocial({
        provider: "google",
        callbackURL: ACCOUNT_PAGE_PATH,
      });
      if (result.error) {
        throw new Error("google-link-failed");
      }
    },
    onError: () => {
      toastManager.add({ title: t("googleLinkError"), type: "error" });
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      isPending={linkMutation.isPending}
      onClick={() => linkMutation.mutate()}
    >
      {t("linkGoogle")}
    </Button>
  );
};
