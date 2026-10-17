"use client";

import { usePathname, useRouter } from "next/navigation";
import { PasskeySetupDialog } from "./passkey-setup-dialog";
import { usePasskeyCapabilities } from "./use-passkey-capabilities";
import { usePasskeyPrompt } from "./use-passkey-prompt";

export const PasskeySetupPrompt = ({ userId, email }: { userId: string; email: string }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { platform } = usePasskeyCapabilities();
  const { open, close } = usePasskeyPrompt(userId, platform && pathname !== "/dashboard/account");
  return (
    <PasskeySetupDialog
      open={open}
      email={email}
      onClose={(registered) => {
        close();
        if (registered) router.refresh();
      }}
    />
  );
};
