import type { DemoStep } from "@/lib/demo/constants";

/**
 * Reports a step of the visitor's demo (`demo_step`, POST /api/demo/event).
 * Fire and forget: `keepalive` lets it leave with a page that navigates away.
 */
export function trackDemoStep(step: DemoStep, guideStep?: string): void {
  try {
    void fetch("/api/demo/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, ...(guideStep ? { guideStep } : {}) }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics never break the demo.
  }
}
