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
  dashboardReservationActions?: {
    cancelReservation?: (reservationId: string) => Promise<{ success?: boolean; error?: string }>
    updateReservationStatus?: (
      reservationId: string,
      status:
        | 'pending'
        | 'confirmed'
        | 'ongoing'
        | 'completed'
        | 'cancelled'
        | 'rejected',
      rejectionReason?: string,
    ) => Promise<
      | { success?: boolean; error?: string }
      | { success?: boolean; warnings?: Array<{ key: string; params?: Record<string, string | number> }> }
    >
    updateReservation?: (
      reservationId: string,
      data: {
        startDate?: Date
        endDate?: Date
        items?: Array<{
          id?: string
          productId?: string | null
          quantity: number
          unitPrice: number
          depositPerUnit: number
          isManualPrice?: boolean
          pricingMode?: 'hour' | 'day' | 'week'
          productSnapshot: {
            name: string
            description?: string | null
            images?: string[]
          }
        }>
      },
    ) => Promise<{ success?: boolean; error?: string } & Record<string, unknown>>
    createManualReservation?: (data: {
      customerId?: string
      newCustomer?: {
        email: string
        firstName: string
        lastName: string
        phone?: string
      }
      startDate: Date
      endDate: Date
      items: Array<{
        productId: string
        quantity: number
        selectedAttributes?: Record<string, string>
        priceOverride?: { unitPrice: number }
      }>
      customItems?: Array<{
        name: string
        description: string
        unitPrice: number
        deposit: number
        quantity: number
        pricingMode: 'hour' | 'day' | 'week'
      }>
      internalNotes?: string
      sendConfirmationEmail?: boolean
    }) => Promise<{ success?: boolean; reservationId?: string; error?: string }>
    getAvailableUnitsForReservationItem?: (
      reservationItemId: string,
    ) => Promise<{ units?: Array<{ id: string; identifier: string; notes: string | null }>; assigned?: string[]; error?: string }>
    assignUnitsToReservationItem?: (
      reservationItemId: string,
      unitIds: string[],
    ) => Promise<{ success?: boolean; error?: string }>
    requestPayment?: (
      reservationId: string,
      data: {
        type: 'rental' | 'deposit' | 'custom'
        amount?: number
        channels: { email: boolean; sms: boolean }
        customMessage?: string
      },
    ) => Promise<{ success?: boolean; error?: string; paymentUrl?: string }>
    recordPayment?: (
      reservationId: string,
      data: {
        type: 'rental' | 'deposit' | 'deposit_return' | 'damage' | 'adjustment'
        amount: number
        method: 'cash' | 'card' | 'transfer' | 'check' | 'other'
        paidAt?: Date
        notes?: string
      },
    ) => Promise<{ success?: boolean; paymentId?: string; error?: string }>
    deletePayment?: (paymentId: string) => Promise<{ success?: boolean; error?: string }>
    returnDeposit?: (
      reservationId: string,
      data: { amount: number; method: 'cash' | 'card' | 'transfer' | 'check' | 'other'; notes?: string },
    ) => Promise<{ success?: boolean; paymentId?: string; error?: string }>
    recordDamage?: (
      reservationId: string,
      data: { amount: number; method: 'cash' | 'card' | 'transfer' | 'check' | 'other'; notes: string },
    ) => Promise<{ success?: boolean; paymentId?: string; error?: string }>
    createDepositHold?: (reservationId: string) => Promise<{ success?: boolean; error?: string } & Record<string, unknown>>
    captureDepositHold?: (
      reservationId: string,
      data: { amount: number; reason: string },
    ) => Promise<{ success?: boolean; error?: string } & Record<string, unknown>>
    releaseDepositHold?: (reservationId: string) => Promise<{ success?: boolean; error?: string } & Record<string, unknown>>
    getReservationPaymentMethod?: (reservationId: string) => Promise<unknown | null>
    sendReservationEmail?: (
      reservationId: string,
      data: { templateId: string; customSubject?: string; customMessage?: string },
    ) => Promise<{ success?: boolean; error?: string }>
    sendAccessLink?: (reservationId: string) => Promise<{ success?: boolean; error?: string } & Record<string, unknown>>
    sendAccessLinkBySms?: (reservationId: string) => Promise<{ success?: boolean; error?: string } & Record<string, unknown>>
  };
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
