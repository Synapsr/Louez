import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";

import { appRouter } from "@louez/api/router";

import { apiPorts } from "@/lib/api/ports";
import { rpcCsrfHandlerPlugin } from "@/lib/orpc/csrf";
import { log, useLogger, withEvlog } from "@/lib/evlog";
import { generateContract } from "@/lib/pdf/generate";
import { getConnectedAccountPayoutPage } from "@/lib/stripe/connected-account-finances";
import { getCurrentStore } from "@/lib/store-context";

import {
  assignUnitsToReservationItem,
  captureDepositHold,
  createDepositHold,
  createManualReservation,
  deletePayment,
  getAvailableUnitsForReservationItem,
  getReservationPaymentMethod,
  getManualEmailRenderContext,
  previewManualReservationTulipQuote,
  previewReservationTulipQuote,
  recordDamage,
  recordPayment,
  refundManualPayment,
  releaseDepositHold,
  requestPayment,
  returnDeposit,
  sendAccessLink,
  sendAccessLinkBySms,
  sendReservationEmail,
  sendReservationModificationEmail,
  updateReservation,
} from "@/app/(dashboard)/dashboard/reservations/actions";
import { getReferralRewardSummary } from "@/app/(dashboard)/dashboard/referrals/actions";
import {
  connectTulipApiKeyAction,
  createTulipProductAction,
  disconnectGoogleCalendarAction,
  disconnectTulipAction,
  getCalendarIntegrationStateAction,
  getIntegrationDetailAction,
  getTulipIntegrationStateAction,
  getTulipProductStateAction,
  listIntegrationsCatalogAction,
  listIntegrationsCategoryAction,
  pushTulipProductUpdateAction,
  resyncGoogleCalendarAction,
  setIntegrationEnabledAction,
  updateGoogleCalendarSettingsAction,
  updateTulipConfigurationAction,
  upsertTulipProductMappingAction,
} from "@/app/(dashboard)/dashboard/settings/integrations/actions";
import { getCustomerSession } from "@/app/(storefront)/[slug]/account/actions";

const handler = new RPCHandler(appRouter, {
  // A call without the app's custom header is refused: no cross-site request
  // rides the session cookie (lib/orpc/csrf.ts).
  plugins: [rpcCsrfHandlerPlugin()],
  interceptors: [
    onError((error) => {
      const rpcError = error instanceof Error ? error : new Error("Unknown oRPC error");

      try {
        useLogger().error(rpcError, { step: "orpc" });
      } catch {
        log.error("orpc", rpcError.message);
      }
    }),
  ],
});

async function handleRequest(request: Request) {
  const logger = useLogger();
  const url = new URL(request.url);

  logger.set({
    rpc: {
      path: url.pathname,
      method: request.method,
    },
  });

  const { response } = await handler.handle(request, {
    prefix: "/api/rpc",
    context: {
      headers: request.headers,
      transport: "rpc",
      ports: apiPorts,
      getCurrentStore,
      getCustomerSession,
      getConnectedAccountPayoutPage,
      dashboardReservationActions: {
        updateReservation,
        previewReservationTulipQuote,
        previewManualTulipQuote: previewManualReservationTulipQuote,
        createManualReservation,
        getAvailableUnitsForReservationItem,
        assignUnitsToReservationItem,
        requestPayment,
        recordPayment,
        refundManualPayment,
        deletePayment,
        returnDeposit,
        recordDamage,
        createDepositHold,
        captureDepositHold,
        releaseDepositHold,
        getReservationPaymentMethod,
        sendReservationEmail,
        getManualEmailRenderContext,
        sendReservationModificationEmail,
        sendAccessLink,
        sendAccessLinkBySms,
      },
      dashboardIntegrationActions: {
        listIntegrationsCatalog: listIntegrationsCatalogAction,
        listIntegrationsCategory: listIntegrationsCategoryAction,
        getIntegrationDetail: getIntegrationDetailAction,
        setIntegrationEnabled: setIntegrationEnabledAction,
        getCalendarIntegrationState: getCalendarIntegrationStateAction,
        updateGoogleCalendarSettings: updateGoogleCalendarSettingsAction,
        resyncGoogleCalendar: resyncGoogleCalendarAction,
        disconnectGoogleCalendar: (input) =>
          disconnectGoogleCalendarAction({
            deleteEvents: input.deleteEvents ?? false,
          }),
        getTulipIntegrationState: getTulipIntegrationStateAction,
        getTulipProductState: getTulipProductStateAction,
        connectTulipApiKey: connectTulipApiKeyAction,
        updateTulipConfiguration: updateTulipConfigurationAction,
        upsertTulipProductMapping: upsertTulipProductMappingAction,
        pushTulipProductUpdate: pushTulipProductUpdateAction,
        createTulipProduct: createTulipProductAction,
        disconnectTulip: async () => disconnectTulipAction({}),
      },
      dashboardReferralActions: {
        getRewardSummary: getReferralRewardSummary,
      },
      regenerateContract: async (reservationId: string) => {
        await generateContract({ reservationId, regenerate: true });
      },
    },
  });

  return response ?? new Response("Not found", { status: 404 });
}

export const GET = withEvlog(handleRequest);
export const POST = withEvlog(handleRequest);
