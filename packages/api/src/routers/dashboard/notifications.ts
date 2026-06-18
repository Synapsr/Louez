import { db } from '@louez/db'
import { pushSubscriptionSchema, unsubscribePushSchema } from '@louez/validations'

import { dashboardProcedure } from '../../procedures'
import {
  listPushSubscriptions,
  subscribePush,
  unsubscribePush,
} from '../../services/push-notifications'
import { toORPCError } from '../../utils/orpc-error'

// Register the current user's device for web push (per-device, upserted by
// endpoint). Which events actually push is decided by the store's
// notificationSettings; this just stores the delivery target.
const subscribe = dashboardProcedure
  .input(pushSubscriptionSchema)
  .handler(async ({ context, input }) => {
    try {
      return await subscribePush({
        db,
        userId: context.session.user!.id!,
        storeId: context.store.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: input.userAgent,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const unsubscribe = dashboardProcedure
  .input(unsubscribePushSchema)
  .handler(async ({ context, input }) => {
    try {
      return await unsubscribePush({
        db,
        userId: context.session.user!.id!,
        endpoint: input.endpoint,
      })
    } catch (error) {
      throw toORPCError(error)
    }
  })

const list = dashboardProcedure.handler(async ({ context }) => {
  try {
    return await listPushSubscriptions({
      db,
      userId: context.session.user!.id!,
    })
  } catch (error) {
    throw toORPCError(error)
  }
})

export const dashboardNotificationsRouter = {
  subscribe,
  unsubscribe,
  list,
}
