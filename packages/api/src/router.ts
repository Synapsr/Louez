import { dashboardRouter } from './routers/dashboard'
import { storefrontRouter } from './routers/storefront'

/**
 * Root application router
 * Combines all sub-routers for dashboard and storefront
 */
export const appRouter = {
  dashboard: dashboardRouter,
  storefront: storefrontRouter,
}

export type AppRouter = typeof appRouter
