"use client";

import { useRouter } from "next/navigation";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOutIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, MenuItem, toastManager } from "@louez/ui";

import { logout } from "@/app/(storefront)/[slug]/account/actions";
import { useStorefrontBasePath } from "@/contexts/store-context";
import { resolveStorefrontHref } from "@/lib/util.storefront-href";

/** Ends the customer session and returns to the store home. */
export const LogoutButton = ({ menuItem = false }: { menuItem?: boolean }) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations("storefront.account");
  const tErrors = useTranslations("errors");
  const basePath = useStorefrontBasePath() ?? "";

  const signOut = useMutation({
    mutationFn: async () => {
      const result = await logout();
      if (!result.ok) throw new Error(result.error);
    },
    onSuccess: () => {
      queryClient.clear();
      router.push(resolveStorefrontHref(basePath, "/"));
      router.refresh();
    },
    onError: () => {
      toastManager.add({ title: tErrors("logoutError"), type: "error" });
    },
  });

  if (menuItem)
    return (
      <MenuItem
        className="min-h-11 px-3 sm:min-h-11 [&>svg]:mx-0"
        disabled={signOut.isPending}
        onClick={() => signOut.mutate()}
      >
        <LogOutIcon aria-hidden />
        {t("logout")}
      </MenuItem>
    );

  return (
    <Button
      variant="ghost"
      className="min-h-11 text-muted-foreground lg:min-h-9"
      isPending={signOut.isPending}
      onClick={() => signOut.mutate()}
    >
      <LogOutIcon data-slot="icon" />
      {t("logout")}
    </Button>
  );
};
