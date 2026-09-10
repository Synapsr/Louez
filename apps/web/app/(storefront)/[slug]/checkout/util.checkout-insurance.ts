import type { TulipInsuranceMode, TulipQuotePreview } from "./checkout.types";

type CheckoutInsuranceState =
  | "hidden"
  | "loading"
  | "unavailable"
  | "unselected"
  | "selected"
  | "included";

/** A quote describes coverage for the future rental; eligibility alone does not. */
export const getCheckoutInsuranceState = ({
  mode,
  preview,
  isLoading,
  isFetched,
  checked,
}: {
  mode: TulipInsuranceMode;
  preview: TulipQuotePreview;
  isLoading: boolean;
  isFetched: boolean;
  checked: boolean;
}): CheckoutInsuranceState => {
  if (mode === "no_public") return "hidden";
  if (isLoading || !isFetched) return "loading";
  if (
    preview.error ||
    preview.quoteUnavailable ||
    !preview.appliedOptIn ||
    preview.insuredProductIds.length === 0
  ) {
    return "unavailable";
  }
  if (mode === "optional" && !checked) return "unselected";
  return preview.inclusionEnabled && preview.amount === 0 ? "included" : "selected";
};
