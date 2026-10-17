"use client";

import { usePathname, useRouter } from "next/navigation";
import { useSaveBarVisible } from "@/hooks/use-save-bar";
import { PasskeySetupCard } from "./passkey-setup-card";
import { usePasskeyCapabilities } from "./use-passkey-capabilities";
import { usePasskeyPrompt } from "./use-passkey-prompt";

export const PasskeySetupPrompt = ({
  userId,
  email,
  expiresAt,
}: {
  userId: string;
  email: string;
  expiresAt: number;
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const { supported } = usePasskeyCapabilities();
  const saveBarVisible = useSaveBarVisible();
  const { open, close, aboveChecklist } = usePasskeyPrompt(
    userId,
    supported && pathname !== "/dashboard/account" && !saveBarVisible,
    expiresAt,
  );
  return (
    <PasskeySetupCard
      open={open}
      aboveChecklist={aboveChecklist}
      email={email}
      onClose={(registered) => {
        close();
        if (registered) router.refresh();
      }}
    />
  );
};
