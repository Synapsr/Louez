"use client";

import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { FingerprintIcon } from "@louez/ui/icons";
import { LoginPasskeyButton } from "./login-passkey-button";

export const LoginPasskeyStep = ({ onUseOtherMethod }: { onUseOtherMethod: () => void }) => {
  const t = useTranslations("auth.passkey");
  return (
    <div className="space-y-6">
      <div className="space-y-3 text-center">
        <div
          className="bg-primary/10 text-primary mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl"
          aria-hidden="true"
        >
          <FingerprintIcon className="size-8" />
        </div>
        <h2 className="text-2xl font-semibold text-balance">{t("login.title")}</h2>
        <p className="text-muted-foreground mx-auto max-w-sm text-pretty text-sm leading-relaxed">
          {t("login.description")}
        </p>
      </div>
      <LoginPasskeyButton primary />
      <Button variant="ghost" size="lg" className="w-full" onClick={onUseOtherMethod}>
        {t("login.otherMethod")}
      </Button>
    </div>
  );
};
