// Export the router type for client-side type inference
export type { AppRouter } from './router'

// Export context types
export type {
  Session,
  BaseContext,
  DashboardContext,
  StorefrontContext,
  MemberRole,
  BaseStoreData,
  StoreData,
  PublicStoreData,
  CustomerData,
} from './context'

// Export procedures for creating new routes
export {
  publicProcedure,
  dashboardProcedure,
  storefrontProcedure,
  storefrontAuthProcedure,
  requirePermission,
} from './procedures'

// Re-export ORPCError for custom error handling
export { ORPCError } from '@orpc/server'
