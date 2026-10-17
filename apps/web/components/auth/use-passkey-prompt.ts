"use client";

import { useEffect, useState } from "react";
import { canPromptPasskey, dismissPasskeyPrompt } from "./util.passkey-preferences";

export const usePasskeyPrompt = (userId: string, enabled: boolean) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled || !canPromptPasskey(userId)) return;
    const timer = window.setTimeout(() => {
      // Do not interrupt onboarding, another dialog, or a form being edited.
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const focused = document.activeElement;
      if (focused?.matches('input, textarea, [contenteditable="true"]')) return;
      dismissPasskeyPrompt(userId);
      setOpen(true);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [enabled, userId]);

  return { open, close: () => setOpen(false) };
};
