import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'
import { appRouter } from '@louez/api/router'
import { getCurrentStore } from '@/lib/store-context'
import { getCustomerSession } from '@/app/(storefront)/[slug]/account/actions'
import { generateContract } from '@/lib/pdf/generate'

const handler = new RPCHandler(appRouter, {
  interceptors: [
    onError((error) => {
      console.error('[oRPC Error]', error)
    }),
  ],
})

async function handleRequest(request: Request) {
  const { response } = await handler.handle(request, {
    prefix: '/api/rpc',
    context: {
      headers: request.headers,
      getCurrentStore,
      getCustomerSession,
      regenerateContract: async (reservationId: string) => {
        await generateContract({ reservationId, regenerate: true })
      },
    },
  })

  return response ?? new Response('Not found', { status: 404 })
}

export const GET = handleRequest
export const POST = handleRequest
