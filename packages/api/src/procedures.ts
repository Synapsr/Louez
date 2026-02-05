import { os, ORPCError } from '@orpc/server'
import type {
  BaseContext,
  DashboardContext,
  StorefrontContext,
  StoreData,
  PublicStoreData,
} from './context'

/**
 * Public procedure - no authentication required
 * Use for public endpoints or health checks
 */
export const publicProcedure = os.$context<BaseContext>()

/**
 * Dashboard procedure - requires authenticated user with store access
 * Integrates with existing getCurrentStore() pattern
 */
export const dashboardProcedure = publicProcedure.use(
  async ({ context, next }) => {
    // Dynamic imports to avoid bundling server code in client
    // These will be resolved at runtime in the Next.js server environment
    const { auth } = await import('@/lib/auth')
    const { getCurrentStore } = await import('@/lib/store-context')

    const session = await auth()
    if (!session?.user) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'errors.unauthenticated',
      })
    }

    const store = await getCurrentStore()
    if (!store) {
      throw new ORPCError('FORBIDDEN', {
        message: 'errors.unauthorized',
      })
    }

    return next({
      context: {
        ...context,
        session,
        store: store as StoreData,
        role: store.role,
      } satisfies DashboardContext,
    })
  }
)

/**
 * Helper to create a procedure that requires a specific permission
 */
export function requirePermission(
  permission: 'read' | 'write' | 'delete' | 'manage_members' | 'manage_settings'
) {
  return dashboardProcedure.use(async ({ context, next }) => {
    const { hasPermission } = await import('@/lib/store-context')
    if (!hasPermission(context.role, permission)) {
      throw new ORPCError('FORBIDDEN', {
        message: 'errors.permissionDenied',
      })
    }
    return next({ context })
  })
}

/**
 * Storefront procedure - public but requires store context via header
 * Use for customer-facing endpoints
 */
export const storefrontProcedure = publicProcedure.use(
  async ({ context, next }) => {
    const { db, stores } = await import('@louez/db')
    const { eq } = await import('drizzle-orm')

    // Get store slug from header (set by client)
    const storeSlug = context.headers.get('x-store-slug')
    if (!storeSlug) {
      throw new ORPCError('BAD_REQUEST', {
        message: 'errors.missingStoreContext',
      })
    }

    // Find store by slug
    const store = await db.query.stores.findFirst({
      where: eq(stores.slug, storeSlug),
    })

    if (!store) {
      throw new ORPCError('NOT_FOUND', {
        message: 'errors.storeNotFound',
      })
    }

    // Get customer session if exists (from cookie)
    // Note: This import path is relative to apps/web where the handler runs
    const { getCustomerSession } = await import(
      '@/app/(storefront)/[slug]/account/actions'
    )
    const customerSession = await getCustomerSession(storeSlug)

    return next({
      context: {
        ...context,
        storeSlug,
        store: store as PublicStoreData,
        customer: customerSession?.customer ?? null,
      } satisfies StorefrontContext,
    })
  }
)

/**
 * Storefront procedure that requires authenticated customer
 */
export const storefrontAuthProcedure = storefrontProcedure.use(
  async ({ context, next }) => {
    if (!context.customer) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'errors.customerNotAuthenticated',
      })
    }
    return next({ context })
  }
)
