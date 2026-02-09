import type { MemberRole, Permission } from '@louez/utils'

/**
 * Minimal Session type matching Better Auth session shape
 */
export interface Session {
  user?: {
    id?: string
    name?: string | null
    email?: string | null
    image?: string | null
  }
  expires: string
}

/**
 * Base store data (without member role)
 */
export type BaseStoreData = {
  id: string
  userId: string
  name: string
  slug: string
  description: string | null
  email: string | null
  phone: string | null
  address: string | null
  logoUrl: string | null
  stripeAccountId: string | null
  stripeChargesEnabled: boolean | null
  createdAt: Date
  updatedAt: Date
}

/**
 * Store data with role information for dashboard context
 */
export type StoreData = BaseStoreData & {
  role: MemberRole
}

/**
 * Public store data for storefront context (no role)
 */
export type PublicStoreData = BaseStoreData

/**
 * Customer session data for storefront
 */
export type CustomerData = {
  id: string
  storeId: string
  firstName: string
  lastName: string
  email: string
  phone: string | null
}

/**
 * Base context provided to all procedures.
 *
 * `getCurrentStore` and `getCustomerSession` are injected by the route handler
 * in apps/web so the API package never imports from the web app directly.
 */
export interface BaseContext {
  headers: Headers
  getCurrentStore?: () => Promise<StoreData | null>
  getCustomerSession?: (
    storeSlug: string,
  ) => Promise<{ customerId: string; customer: CustomerData } | null>
}

/**
 * Dashboard context - authenticated user with store access
 */
export interface DashboardContext extends BaseContext {
  session: Session
  store: StoreData
  role: MemberRole
}

/**
 * Storefront context - public or authenticated customer
 * Uses PublicStoreData (no role) since visitors are not store members
 */
export interface StorefrontContext extends BaseContext {
  storeSlug: string
  store: PublicStoreData
  customer: CustomerData | null
}

export type { MemberRole, Permission }
