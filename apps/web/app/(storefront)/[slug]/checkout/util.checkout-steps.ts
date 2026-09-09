import type { StepId } from "./checkout.types";

interface StepOptions {
  isDeliveryEnabled: boolean;
}

export const getCheckoutStepIds = ({ isDeliveryEnabled }: StepOptions): StepId[] =>
  isDeliveryEnabled ? ["contact", "delivery", "confirm"] : ["contact", "confirm"];

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
export const getStepForErrorKey = (errorKey: string, isDeliveryEnabled: boolean): StepId => {
  const key = errorKey.toLowerCase();
  if (isDeliveryEnabled && DELIVERY_ERROR_HINTS.some((hint) => key.includes(hint))) {
    return "delivery";
  }
  if (CONTACT_ERROR_HINTS.some((hint) => key.includes(hint))) {
    return "contact";
  }
  return "confirm";
};

/** `StepActions`: sticky on phones, back in the flow at `lg` where the column has room. */
export const STEP_ACTIONS_CLASS =
  "mt-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none";
