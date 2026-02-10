/**
 * Minimal Session type matching next-auth Session
 * Defined locally to avoid dependency on next-auth in this package
 */
export interface Session {
  user?: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  expires: string;
}

/**
 * Store data with role information
 * Matches StoreWithFullData from apps/web/lib/store-context.ts
 */
export type MemberRole = 'owner' | 'member' | 'platform_admin';

/**
 * Base store data (without member role)
 */
export type BaseStoreData = {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Store data with role information for dashboard context
 * Matches StoreWithFullData from apps/web/lib/store-context.ts
 */
export type StoreData = BaseStoreData & {
  role: MemberRole;
};

/**
 * Public store data for storefront context (no role)
 */
export type PublicStoreData = BaseStoreData;

/**
 * Customer session data for storefront
 */
export type CustomerData = {
  id: string;
  storeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
};

/**
 * Base context provided to all procedures
 */
export interface BaseContext {
  headers: Headers;
  getCurrentStore?: () => Promise<(StoreData & Record<string, unknown>) | null>;
  getCustomerSession?: (
    storeSlug: string,
  ) => Promise<{ customer: CustomerData } | null>;
  regenerateContract?: (reservationId: string) => Promise<void>;
  notifyStoreCreated?: (store: {
    id: string;
    name: string;
    slug: string;
  }) => Promise<void>;
  uploadImageToStorage?: (params: {
    key: string;
    body: Buffer;
    contentType: string;
  }) => Promise<string>;
  getStorageKey?: (
    storeId: string,
    type: 'logo' | 'products' | 'documents' | 'inspections',
    ...parts: string[]
  ) => string;
}

/**
 * Dashboard context - authenticated user with store access
 */
export interface DashboardContext extends BaseContext {
  session: Session;
  store: StoreData;
  role: MemberRole;
}

/**
 * Storefront context - public or authenticated customer
 * Uses PublicStoreData (no role) since visitors are not store members
 */
export interface StorefrontContext extends BaseContext {
  storeSlug: string;
  store: PublicStoreData;
  customer: CustomerData | null;
}
