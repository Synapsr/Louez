"use client";

import { useEffect, useState, useTransition } from "react";

import { startBillingCardSetup } from "./actions";

/**
 * "Add a card": opens Stripe Checkout in setup mode, which comes back to the page that
 * opened it (`from`). `opening` stays on until the browser leaves for Stripe.
 */
export function useCardSetup(from: "settings" | "onboarding") {
  const [pending, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // Back from Stripe with the browser's back button, a page restored from its cache
  // would still say Stripe's page is opening.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);

  const start = () => {
    setFailed(false);
    startTransition(async () => {
      const result = await startBillingCardSetup(from);
      if ("url" in result) {
        setLeaving(true);
        window.location.assign(result.url);
      } else {
        setFailed(true);
      }
    });
  };

  return { start, opening: pending || leaving, failed };
}
