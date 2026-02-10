import { onError } from '@orpc/server';
import { RPCHandler } from '@orpc/server/fetch';

import { appRouter } from '@louez/api/router';

import { notifyStoreCreated as sendStoreCreatedNotification } from '@/lib/discord/platform-notifications';
import { generateContract } from '@/lib/pdf/generate';
import { getStorageKey, uploadFile } from '@/lib/storage/client';
import { getCurrentStore } from '@/lib/store-context';

import { getCustomerSession } from '@/app/(storefront)/[slug]/account/actions';

const handler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error('[oRPC Error]', error);
    }),
  ],
});

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: {
      headers: request.headers,
      getCurrentStore,
      getCustomerSession,
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

export const GET = handleRequest;
export const POST = handleRequest;
