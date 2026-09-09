import { storefrontAiAdvisorRouter } from "./ai-advisor";
import { storefrontAvailabilityRouter } from "./availability";
import { storefrontCartRouter } from "./cart";
import { storefrontPromoRouter } from "./promo";
import { storefrontReservationsRouter } from "./reservations";

/**
 * Storefront router - procedures for customer-facing features
 * Add new sub-routers here as features are implemented
 */
export const storefrontRouter = {
  aiAdvisor: storefrontAiAdvisorRouter,
  availability: storefrontAvailabilityRouter,
  cart: storefrontCartRouter,
  promo: storefrontPromoRouter,
  reservations: storefrontReservationsRouter,
};
