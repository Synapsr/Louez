"use client";

import { useEffect, useState } from "react";
import { canPromptPasskey, dismissPasskeyPrompt } from "./util.passkey-preferences";

export const usePasskeyPrompt = (userId: string, enabled: boolean, expiresAt: number) => {
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [aboveChecklist, setAboveChecklist] = useState(false);

  useEffect(() => {
    if (!enabled || dismissed || !canPromptPasskey(userId)) return;
    let timer: number;
    const check = () => {
      // Layouts persist across navigation. Stop offering enrollment once the
      // recent-session window closes, even if this page has stayed open.
      if (Date.now() >= expiresAt) {
        setOpen(false);
        return;
      }
      const focused = document.activeElement;
      setAboveChecklist(Boolean(document.querySelector("[data-setup-checklist]")));
      const busy =
        document.hidden ||
        document.querySelector(
          '[role="dialog"], [role="alertdialog"], [data-setup-checklist="open"], [data-slot="toast-title"]',
        ) ||
        focused?.matches('input, textarea, [contenteditable="true"]');
      setOpen(!busy);
      // A temporary overlay must defer the invitation, not discard it. Yield
      // again if onboarding or a form takes precedence after it was shown.
      timer = window.setTimeout(check, 1000);
    };
    timer = window.setTimeout(check, 6000);
    return () => window.clearTimeout(timer);
  }, [enabled, dismissed, expiresAt, userId]);

  return {
    open: enabled && !dismissed && open,
    aboveChecklist,
    close: () => {
      dismissPasskeyPrompt(userId);
      setDismissed(true);
    },
  };
};
