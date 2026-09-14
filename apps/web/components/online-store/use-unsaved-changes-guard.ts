"use client";

import { useEffect } from "react";

/**
 * Asks before the tab closes or reloads while the editor holds unsaved
 * changes. In-app navigation is guarded by the top bar's back link, which
 * asks with the same message; Next.js has no route-change interception.
 */
export const useUnsavedChangesGuard = (isDirty: boolean) => {
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);
};
