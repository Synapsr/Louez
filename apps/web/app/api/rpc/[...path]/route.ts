import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';

import { appRouter } from '@louez/api/router';

import { notifyStoreCreated as sendStoreCreatedNotification } from '@/lib/discord/platform-notifications';
import { log, useLogger, withEvlog } from '@/lib/evlog';
import { generateContract } from '@/lib/pdf/generate';
import { getStorageKey, uploadFile } from '@/lib/storage/client';
import { getCurrentStore } from '@/lib/store-context';

import {
  assignUnitsToReservationItem,
  cancelReservation,
  captureDepositHold,
  createDepositHold,
  createManualReservation,
  deletePayment,
  getAvailableUnitsForReservationItem,
  getReservationPaymentMethod,
  previewManualReservationTulipQuote,
  previewReservationTulipQuote,
  recordDamage,
  recordPayment,
  releaseDepositHold,
  requestPayment,
  returnDeposit,
  sendAccessLink,
  sendAccessLinkBySms,
  sendReservationEmail,
  sendReservationModificationEmail,
  updateReservation,
  updateReservationStatus,
} from '@/app/(dashboard)/dashboard/reservations/actions';
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
} from '@/app/(dashboard)/dashboard/settings/integrations/actions';
import { getCustomerSession } from '@/app/(storefront)/[slug]/account/actions';

const handler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      const rpcError =
        error instanceof Error ? error : new Error('Unknown oRPC error');

      try {
        useLogger().error(rpcError, { step: 'orpc' });
      } catch {
        log.error('orpc', rpcError.message);
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
    prefix: '/api/rpc',
    context: {
      headers: request.headers,
      getCurrentStore,
      getCustomerSession,
      dashboardReservationActions: {
        cancelReservation,
        updateReservationStatus,
        updateReservation,
        previewReservationTulipQuote,
        previewManualTulipQuote: previewManualReservationTulipQuote,
        createManualReservation,
        getAvailableUnitsForReservationItem,
        assignUnitsToReservationItem,
        requestPayment,
        recordPayment,
        deletePayment,
        returnDeposit,
        recordDamage,
        createDepositHold,
        captureDepositHold,
        releaseDepositHold,
        getReservationPaymentMethod,
        sendReservationEmail,
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
      regenerateContract: async (reservationId: string) => {
        await generateContract({ reservationId, regenerate: true });
      },
      notifyStoreCreated: async (store: {
        id: string;
        name: string;
        slug: string;
      }) => {
        await sendStoreCreatedNotification(store);
      },
      uploadImageToStorage: async ({
        key,
        body,
        contentType,
      }: {
        key: string;
        body: Buffer;
        contentType: string;
      }) => {
        return uploadFile({
          key,
          body,
          contentType,
        });
      },
      getStorageKey: (
        storeId: string,
        type: 'logo' | 'products' | 'documents' | 'inspections',
        ...parts: string[]
      ) => getStorageKey(storeId, type, ...parts),
    },
  });

  return response ?? new Response('Not found', { status: 404 });
}

export const GET = withEvlog(handleRequest);
export const POST = withEvlog(handleRequest);
