import { dashboardRouter } from './routers/dashboard'
import { publicRouter } from './routers/public'
import { storefrontRouter } from './routers/storefront'

/**
 * Root application router
 * Combines all sub-routers for dashboard and storefront
 */
export const appRouter = {
  public: publicRouter,
  dashboard: dashboardRouter,
  storefront: storefrontRouter,
}

export type AppRouter = typeof appRouter
