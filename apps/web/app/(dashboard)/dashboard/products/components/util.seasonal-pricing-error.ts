import { apiErrorKey } from "@/lib/orpc/errors";

type Translate = ((key: string) => string) & { has: (key: string) => boolean };

/**
 * The message to show for a refused seasonal price write: the form's own
 * wording for overlapping or reversed days, else the API error's key.
 */
export function seasonalPricingErrorMessage(
  error: unknown,
  t: Translate,
  tErrors: Translate,
): string {
  const code = (error as { data?: { code?: unknown } } | null)?.data?.code;
  if (code === "SEASONAL_PRICING_OVERLAP") return t("seasonOverlapError");
  if (code === "SEASONAL_PRICING_DATES_INVALID") return t("seasonDateError");
  const key = apiErrorKey(error);
  return key && tErrors.has(key) ? tErrors(key) : tErrors("generic");
}
