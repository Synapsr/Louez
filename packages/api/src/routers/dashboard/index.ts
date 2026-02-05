import { z } from 'zod'
import { dashboardProcedure } from '../../procedures'

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
    }
  })

/**
 * Dashboard router - procedures for authenticated store members
 * Add new sub-routers here as features are implemented
 */
export const dashboardRouter = {
  ping,
  // Add more routers here:
  // products: productsRouter,
  // reservations: reservationsRouter,
  // analytics: analyticsRouter,
}
