import { storefrontProcedure } from '../../procedures';
import { storefrontAvailabilityRouter } from './availability';
import { storefrontCartRouter } from './cart';
import { storefrontReservationsRouter } from './reservations';

/**
 * Example storefront procedure for testing the setup
 * Remove or replace with real procedures as needed
 */
const storeInfo = storefrontProcedure.handler(async ({ context }) => {
  return {
    name: context.store.name,
    slug: context.store.slug,
    description: context.store.description,
    email: context.store.email,
    phone: context.store.phone,
    address: context.store.address,
    logoUrl: context.store.logoUrl,
    isCustomerLoggedIn: context.customer !== null,
  };
});

/**
 * Storefront router - procedures for customer-facing features
 * Add new sub-routers here as features are implemented
 */
export const storefrontRouter = {
  storeInfo,
  availability: storefrontAvailabilityRouter,
  cart: storefrontCartRouter,
  reservations: storefrontReservationsRouter,
};
