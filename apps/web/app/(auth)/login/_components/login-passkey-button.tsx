"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { FingerprintIcon } from "@louez/ui/icons";
import { passkeyErrorKey } from "@/components/auth/util.passkey-errors";
import { passkeyMutations } from "@/lib/queries/passkey.queries";
import { useCallbackUrl } from "./use-callback-url";

export const LoginPasskeyButton = ({
  primary = false,
  disabled = false,
}: {
  primary?: boolean;
  disabled?: boolean;
}) => {
  const t = useTranslations("auth.passkey");
  const callbackUrl = useCallbackUrl();
  const mutation = useMutation({
    ...passkeyMutations.signIn(),
    onSuccess: () => {
      window.location.assign(callbackUrl);
    },
  });
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant={primary ? "default" : "outline"}
        size="xl"
        className="h-auto min-h-12 w-full py-3 whitespace-normal"
        onClick={() => mutation.mutate()}
        disabled={disabled || mutation.isPending}
        isPending={mutation.isPending}
      >
        <FingerprintIcon data-slot="icon" aria-hidden="true" />
        {t(mutation.isPending ? "login.waiting" : "login.continue")}
      </Button>
      {mutation.isError && (
        <p className="text-destructive text-pretty text-center text-sm" role="alert">
          {t(passkeyErrorKey(mutation.error))}
        </p>
      )}
    </div>
  );
};
