"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { createDepositAuthorizationLink } from "@/app/(storefront)/[slug]/account/reservations/[reservationId]/actions";

interface AuthorizeDepositButtonProps {
  storeSlug: string;
  reservationId: string;
}

/**
 * Mints a short-lived link to the deposit authorisation page and follows
 * it. The page itself owns the card form, so this stays a plain redirect.
 */
export const AuthorizeDepositButton = ({
  storeSlug,
  reservationId,
}: AuthorizeDepositButtonProps) => {
  const t = useTranslations("storefront.account.depositCard");
  const [failed, setFailed] = useState(false);

  const authorize = useMutation({
    mutationFn: async () => {
      const result = await createDepositAuthorizationLink(storeSlug, reservationId);
      if ("url" in result) return result.url;
      throw new Error(result.error);
    },
    onMutate: () => setFailed(false),
    onSuccess: (url) => window.location.assign(url),
    onError: () => setFailed(true),
  });

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="xl"
        className="w-full"
        isPending={authorize.isPending}
        onClick={() => authorize.mutate()}
      >
        <ShieldCheckIcon data-slot="icon" />
        {t("authorize")}
      </Button>
      <p className="text-center text-xs text-muted-foreground">{t("authorizeHelp")}</p>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          {t("authorizeError")}
        </p>
      ) : null}
    </div>
  );
};
