import type { StepId } from "./checkout.types";

interface StepOptions {
  isDeliveryEnabled: boolean;
  /** A cart line asks item-scope custom fields ("Détails de la location"). */
  hasDetailsStep?: boolean;
}

export const getCheckoutStepIds = ({
  isDeliveryEnabled,
  hasDetailsStep,
}: StepOptions): StepId[] => [
  "contact",
  ...(hasDetailsStep ? ["details" as const] : []),
  ...(isDeliveryEnabled ? ["delivery" as const] : []),
  "confirm",
];

/** Keeps only the string/number params next-intl can interpolate. */
export const sanitizeTranslationParams = (
  params: Record<string, unknown> | undefined,
): Record<string, string | number> => {
  if (!params) return {};

  const cleaned: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number") {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

const CONTACT_ERROR_HINTS = [
  "customer",
  "email",
  "phone",
  "company",
  "vat",
  "address",
  "postal",
  "city",
];
const DELIVERY_ERROR_HINTS = ["delivery", "distance", "location"];

/** Step a server error key points at, so the alert can jump to it. */
export const getStepForErrorKey = (
  errorKey: string,
  isDeliveryEnabled: boolean,
  hasDetailsStep = false,
): StepId => {
  const key = errorKey.toLowerCase();
  // `errors.profileField*`, `errors.customField*` and `errors.itemDetail*`:
  // native and custom fields asked by the store.
  if (key.includes("profilefield") || key.includes("customfield")) return "contact";
  if (key.includes("itemdetail")) return hasDetailsStep ? "details" : "confirm";
  if (isDeliveryEnabled && DELIVERY_ERROR_HINTS.some((hint) => key.includes(hint))) {
    return "delivery";
  }
  if (CONTACT_ERROR_HINTS.some((hint) => key.includes(hint))) {
    return "contact";
  }
  return "confirm";
};
