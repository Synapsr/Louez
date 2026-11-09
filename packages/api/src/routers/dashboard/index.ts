import { z } from "zod";

import { dashboardProcedure } from "../../procedures";
import { dashboardAccountRouter } from "./account";
import { dashboardAgentConnectionsRouter } from "./agent-connections";
import { dashboardAiAdvisorRouter } from "./ai-advisor";
import { dashboardApiKeysRouter } from "./api-keys";
import { dashboardBillingRouter } from "./billing";
import { dashboardCategoriesRouter } from "./categories";
import { dashboardCustomerFieldsRouter } from "./customer-fields";
import { dashboardCustomersRouter } from "./customers";
import { dashboardHandoffsRouter } from "./handoffs";
import { dashboardInboxRouter } from "./inbox";
import { dashboardIntegrationsRouter } from "./integrations";
import { dashboardJobsRouter } from "./jobs";
import { dashboardNotificationsRouter } from "./notifications";
import { dashboardOnboardingRouter } from "./onboarding";
import { dashboardOnlineStoreRouter } from "./online-store";
import { dashboardPaymentsRouter } from "./payments";
import { dashboardProductsRouter } from "./products";
import { dashboardReferralRouter } from "./referral";
import { dashboardReservationDetailsRouter } from "./reservation-details";
import { dashboardReservationsRouter } from "./reservations";
import { dashboardSearchRouter } from "./search";
import { dashboardSettingsRouter } from "./settings";
import { dashboardStoresRouter } from "./stores";

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
  account: dashboardAccountRouter,
  agentConnections: dashboardAgentConnectionsRouter,
  aiAdvisor: dashboardAiAdvisorRouter,
  apiKeys: dashboardApiKeysRouter,
  billing: dashboardBillingRouter,
  categories: dashboardCategoriesRouter,
  customers: dashboardCustomersRouter,
  customerFields: dashboardCustomerFieldsRouter,
  handoffs: dashboardHandoffsRouter,
  inbox: dashboardInboxRouter,
  integrations: dashboardIntegrationsRouter,
  jobs: dashboardJobsRouter,
  reservations: dashboardReservationsRouter,
  reservationDetails: dashboardReservationDetailsRouter,
  search: dashboardSearchRouter,
  settings: dashboardSettingsRouter,
  stores: dashboardStoresRouter,
  onboarding: dashboardOnboardingRouter,
  onlineStore: dashboardOnlineStoreRouter,
  payments: dashboardPaymentsRouter,
  products: dashboardProductsRouter,
  notifications: dashboardNotificationsRouter,
  referral: dashboardReferralRouter,
};
