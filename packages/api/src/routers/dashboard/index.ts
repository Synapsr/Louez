import { z } from "zod";

import { dashboardProcedure } from "../../procedures";
import { dashboardAiAdvisorRouter } from "./ai-advisor";
import { dashboardApiKeysRouter } from "./api-keys";
import { dashboardCategoriesRouter } from "./categories";
import { dashboardCustomersRouter } from "./customers";
import { dashboardIntegrationsRouter } from "./integrations";
import { dashboardNotificationsRouter } from "./notifications";
import { dashboardOnboardingRouter } from "./onboarding";
import { dashboardPaymentsRouter } from "./payments";
import { dashboardProductsRouter } from "./products";
import { dashboardReferralRouter } from "./referral";
import { dashboardReservationsRouter } from "./reservations";
import { dashboardSearchRouter } from "./search";
import { dashboardSettingsRouter } from "./settings";
import { dashboardVariantsRouter } from "./variants";

/**
 * Example dashboard procedure for testing the setup
 * Remove or replace with real procedures as needed
 */
const ping = dashboardProcedure
  .input(z.object({ message: z.string() }))
  .handler(async ({ input, context }) => {
    return {
      echo: input.message,
      store: context.store.name,
      storeId: context.store.id,
      userId: context.session.user?.id,
      timestamp: new Date().toISOString(),
    };
  });

/**
 * Dashboard router - procedures for authenticated store members
 * Add new sub-routers here as features are implemented
 */
export const dashboardRouter = {
  ping,
  aiAdvisor: dashboardAiAdvisorRouter,
  apiKeys: dashboardApiKeysRouter,
  categories: dashboardCategoriesRouter,
  customers: dashboardCustomersRouter,
  integrations: dashboardIntegrationsRouter,
  settings: dashboardSettingsRouter,
  reservations: dashboardReservationsRouter,
  search: dashboardSearchRouter,
  onboarding: dashboardOnboardingRouter,
  payments: dashboardPaymentsRouter,
  products: dashboardProductsRouter,
  notifications: dashboardNotificationsRouter,
  referral: dashboardReferralRouter,
  variants: dashboardVariantsRouter,
};
