"use client";

import { useId } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { CheckIcon, FingerprintIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";
import { passkeyMutations } from "@/lib/queries/passkey.queries";
import { PasskeyReauthenticate } from "./passkey-reauthenticate";
import { passkeyErrorKey } from "./util.passkey-errors";

interface PasskeySetupCardProps {
  open: boolean;
  aboveChecklist: boolean;
  email: string;
  onClose: (registered: boolean) => void;
}

export const PasskeySetupCard = ({
  open,
  aboveChecklist,
  email,
  onClose,
}: PasskeySetupCardProps) => {
  const t = useTranslations("auth.passkey");
  const titleId = useId();
  const mutation = useMutation(passkeyMutations.register());
  const errorKey = mutation.isError ? passkeyErrorKey(mutation.error) : null;

  if (!open) return null;

  return (
    <aside
      data-passkey-prompt=""
      aria-labelledby={titleId}
      className={cn(
        "bg-popover text-popover-foreground ring-border/60 fixed right-4 left-4 z-40 max-h-[calc(100svh-6rem)] overflow-y-auto overscroll-contain rounded-2xl p-5 shadow-xl ring-1 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200 sm:right-6 sm:left-auto sm:w-96",
        aboveChecklist ? "bottom-20" : "bottom-4 sm:bottom-6",
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl"
          aria-hidden="true"
        >
          {mutation.isSuccess ? (
            <CheckIcon className="size-6" />
          ) : (
            <FingerprintIcon className="size-6" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-muted-foreground text-xs">{t("settings.title")}</p>
          <p className="mt-0.5 truncate text-sm font-medium" title={email}>
            {email}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-2" role="status" aria-live="polite">
        <h2 id={titleId} className="text-base font-semibold text-balance">
          {t(mutation.isSuccess ? "setup.successTitle" : "prompt.title")}
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed text-pretty">
          {t(mutation.isSuccess ? "setup.successDescription" : "setup.description")}
        </p>
      </div>

      {errorKey && (
        <p className="text-destructive mt-3 text-sm" role="alert">
          {t(errorKey)}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {errorKey === "errors.reauthenticate" ? (
          <PasskeyReauthenticate />
        ) : (
          <Button
            size="lg"
            className="h-auto min-h-10 w-full py-2.5 whitespace-normal"
            onClick={mutation.isSuccess ? () => onClose(true) : () => mutation.mutate()}
            disabled={mutation.isPending}
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
        )}
        {!mutation.isSuccess && (
          <Button
            size="lg"
            variant="ghost"
            className="w-full"
            onClick={() => onClose(false)}
            disabled={mutation.isPending}
          >
            {t("setup.later")}
          </Button>
        )}
      </div>
    </aside>
  );
};
