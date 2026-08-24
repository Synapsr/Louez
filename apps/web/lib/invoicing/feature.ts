import { env } from "@/env";
import { log } from "@/lib/evlog";
import { getPostHogServer } from "@/lib/posthog";

const ELECTRONIC_INVOICING_FLAG = "electronic-invoicing";

/**
 * Store-scoped rollout brake for electronic invoicing.
 *
 * Development without PostHog and missing/unevaluable flags fail open. Only
 * an explicit false evaluation disables the feature.
 */
export async function isElectronicInvoicingEnabled(storeId: string): Promise<boolean> {
  if (!env.NEXT_PUBLIC_POSTHOG_KEY) return true;

  try {
    const enabled = await getPostHogServer().isFeatureEnabled(ELECTRONIC_INVOICING_FLAG, storeId);
    return enabled ?? true;
  } catch (error) {
    log.error(
      "invoicing",
      `feature flag evaluation failed for store ${storeId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return true;
  }
}
