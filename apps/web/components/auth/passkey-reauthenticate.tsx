"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { passkeyMutations } from "@/lib/queries/passkey.queries";

export const PasskeyReauthenticate = () => {
  const t = useTranslations("auth.passkey");
  const mutation = useMutation(passkeyMutations.reauthenticate());
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="lg"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
      >
        {t("reauthenticate")}
      </Button>
      {mutation.isError && (
        <p className="text-destructive text-sm" role="alert">
          {t("errors.failed")}
        </p>
      )}
    </div>
  );
};
