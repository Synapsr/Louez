"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@louez/ui";
import { FingerprintIcon } from "@louez/ui/icons";
import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";
import { PasskeyRemoveDialog } from "./passkey-remove-dialog";
import { PasskeySetupDialog } from "./passkey-setup-dialog";
import { usePasskeyCapabilities } from "./use-passkey-capabilities";
import { dismissPasskeyPrompt } from "./util.passkey-preferences";

interface PasskeySettingsCardProps {
  userId: string;
  email: string;
  passkeys: { id: string; name: string | null; createdAt: Date }[];
}

export const PasskeySettingsCard = ({ userId, email, passkeys }: PasskeySettingsCardProps) => {
  const t = useTranslations("auth.passkey");
  const router = useRouter();
  const { supported } = usePasskeyCapabilities();
  const [open, setOpen] = useState(false);
  return (
    <DashboardSectionCard
      title={t("settings.title")}
      description={t("settings.description")}
      icon={FingerprintIcon}
    >
      <div className="space-y-5">
        {passkeys.length > 0 ? (
          <ul className="divide-y">
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {passkey.name || t("settings.defaultName")}
                  </p>
                  <p className="text-muted-foreground mt-1 text-xs">
                    {t("settings.created", { date: passkey.createdAt })}
                  </p>
                </div>
                <PasskeyRemoveDialog id={passkey.id} lastPasskey={passkeys.length === 1} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("settings.empty")}</p>
        )}
        <div className="space-y-2">
          <Button variant="outline" size="lg" onClick={() => setOpen(true)} disabled={!supported}>
            <FingerprintIcon data-slot="icon" aria-hidden="true" />
            {t("settings.add")}
          </Button>
          {!supported && (
            <p className="text-muted-foreground text-xs">{t("settings.unsupported")}</p>
          )}
        </div>
      </div>
      <PasskeySetupDialog
        open={open}
        email={email}
        onClose={(registered) => {
          setOpen(false);
          if (registered) {
            dismissPasskeyPrompt(userId);
            router.refresh();
          }
        }}
      />
    </DashboardSectionCard>
  );
};
