import { auth } from '@louez/auth'
import { db, stores } from '@louez/db'
import { hasPermission } from '@louez/utils'
import type { Permission } from '@louez/utils'
import { eq } from 'drizzle-orm'
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
 */
export const publicProcedure = os.$context<BaseContext>()

/**
 * Dashboard procedure - requires authenticated user with store access.
 * `getCurrentStore` is injected via context by the route handler.
 */
export const dashboardProcedure = publicProcedure.use(
  async ({ context, next }) => {
    const session = await auth()
    if (!session?.user) {
      throw new ORPCError('UNAUTHORIZED', {
        message: 'errors.unauthenticated',
      })
    }

    if (!context.getCurrentStore) {
      throw new ORPCError('INTERNAL_SERVER_ERROR', {
        message: 'getCurrentStore not provided in context',
      })
    }

    const store = await context.getCurrentStore()
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
  },
)

/**
 * Helper to create a procedure that requires a specific permission
 */
export function requirePermission(permission: Permission) {
  return dashboardProcedure.use(async ({ context, next }) => {
    if (!hasPermission(context.role, permission)) {
      throw new ORPCError('FORBIDDEN', {
        message: 'errors.permissionDenied',
      })
    }
    return next({ context })
  })
}

/**
 * Storefront procedure - public but requires store context via header.
 * `getCustomerSession` is injected via context by the route handler.
 */
export const storefrontProcedure = publicProcedure.use(
  async ({ context, next }) => {
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
    let customer = null
    if (context.getCustomerSession) {
      const customerSession = await context.getCustomerSession(storeSlug)
      customer = customerSession?.customer ?? null
    }

    return next({
      context: {
        ...context,
        storeSlug,
        store: store as PublicStoreData,
        customer,
      } satisfies StorefrontContext,
    })
  },
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
  },
)
