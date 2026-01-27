import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stores, storeMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { isPlatformAdmin } from '@/lib/platform-admin'
import type { StoreSettings, StoreTheme, EmailSettings, ReviewBoosterSettings, NotificationSettings, CustomerNotificationSettings } from '@/types/store'

const ACTIVE_STORE_COOKIE = 'louez_active_store'

export type MemberRole = 'owner' | 'member' | 'platform_admin'

export type StoreWithRole = {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  role: MemberRole
}

export type StoreWithFullData = {
  id: string
  userId: string
  name: string
  slug: string
  description: string | null
  email: string | null
  phone: string | null
  address: string | null
  latitude: string | null
  longitude: string | null
  logoUrl: string | null
  darkLogoUrl: string | null
  settings: StoreSettings | null
  theme: StoreTheme | null
  cgv: string | null
  legalNotice: string | null
  stripeAccountId: string | null
  stripeOnboardingComplete: boolean | null
  stripeChargesEnabled: boolean | null
  emailSettings: EmailSettings | null
  reviewBoosterSettings: ReviewBoosterSettings | null
  notificationSettings: NotificationSettings | null
  discordWebhookUrl: string | null
  ownerPhone: string | null
  customerNotificationSettings: CustomerNotificationSettings | null
  icsToken: string | null
  referralCode: string | null
  trialDays: number
  onboardingCompleted: boolean | null
  createdAt: Date
  updatedAt: Date
  role: MemberRole
}

/**
 * Get all stores the current user has access to
 * Platform admins get access to ALL stores with role 'platform_admin'
 */
export async function getUserStores(): Promise<StoreWithRole[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const isAdmin = isPlatformAdmin(session.user.email)

  // Platform admins can access all stores
  if (isAdmin) {
    // First, get stores where user is a natural member
    const memberStores = await db
      .select({
        id: stores.id,
        name: stores.name,
        slug: stores.slug,
        logoUrl: stores.logoUrl,
        role: storeMembers.role,
      })
      .from(stores)
      .innerJoin(storeMembers, eq(stores.id, storeMembers.storeId))
      .where(eq(storeMembers.userId, session.user.id))

    const memberStoreIds = new Set(memberStores.map((s) => s.id))

    // Then get all other stores (where admin is not a natural member)
    const allStores = await db
      .select({
        id: stores.id,
        name: stores.name,
        slug: stores.slug,
        logoUrl: stores.logoUrl,
      })
      .from(stores)
      .orderBy(stores.name)

    // Combine: natural membership stores + admin-only stores
    const result: StoreWithRole[] = []

    for (const store of allStores) {
      if (memberStoreIds.has(store.id)) {
        // User is a natural member - use their actual role
        const memberStore = memberStores.find((s) => s.id === store.id)!
        result.push(memberStore as StoreWithRole)
      } else {
        // Admin access only - mark with platform_admin role
        result.push({
          ...store,
          role: 'platform_admin' as const,
        })
      }
    }

    return result
  }

  // Regular users: only stores they are members of
  const results = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      logoUrl: stores.logoUrl,
      role: storeMembers.role,
    })
    .from(stores)
    .innerJoin(storeMembers, eq(stores.id, storeMembers.storeId))
    .where(eq(storeMembers.userId, session.user.id))
    .orderBy(stores.name)

  return results as StoreWithRole[]
}

/**
 * Get the currently active store ID from cookie
 */
export async function getActiveStoreId(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(ACTIVE_STORE_COOKIE)?.value || null
}

/**
 * Set the active store ID in cookie
 * Validates that the user has access to the store before setting (defense in depth)
 */
export async function setActiveStoreId(storeId: string): Promise<{ success: boolean; error?: string }> {
  // Validate storeId format (21-char nanoid)
  if (!storeId || typeof storeId !== 'string' || storeId.length !== 21) {
    console.warn('[SECURITY] setActiveStoreId called with invalid storeId format:', storeId?.substring(0, 30))
    return { success: false, error: 'errors.invalidStoreId' }
  }

  // Verify user is authenticated and has access to this store
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: 'errors.unauthenticated' }
  }

  // Use verifyStoreAccess which handles both regular members and platform admins
  const role = await verifyStoreAccess(storeId)
  if (!role) {
    // Log attempted unauthorized access for security monitoring
    console.warn(
      `[SECURITY] User ${session.user.id} attempted to set active store to ${storeId} without access`
    )
    return { success: false, error: 'errors.unauthorized' }
  }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  })

  return { success: true }
}

/**
 * Clear the active store cookie
 */
export async function clearActiveStore(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(ACTIVE_STORE_COOKIE)
}

/**
 * Get the current store for the user with validation
 * This replaces the old getStoreForUser() pattern
 * Note: This does NOT set cookies - use setActiveStoreId in Server Actions only
 */
export async function getCurrentStore(): Promise<StoreWithFullData | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userStores = await getUserStores()
  if (userStores.length === 0) return null

  // Get active store from cookie
  const activeStoreId = await getActiveStoreId()

  // Validate that user has access to the active store
  let activeStore = userStores.find((s) => s.id === activeStoreId)

  // If no valid active store, default to first store (but don't set cookie here)
  if (!activeStore) {
    activeStore = userStores[0]
    // Cookie will be set via middleware or Server Action
  }

  // Fetch full store data
  const store = await db.query.stores.findFirst({
    where: eq(stores.id, activeStore.id),
  })

  if (!store) return null

  return {
    ...store,
    role: activeStore.role,
  } as StoreWithFullData
}

/**
 * Get the current store ID (lightweight version for actions)
 * Note: This does NOT set cookies - defaults to first store if no cookie
 */
export async function getCurrentStoreId(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userStores = await getUserStores()
  if (userStores.length === 0) return null

  const activeStoreId = await getActiveStoreId()
  const activeStore = userStores.find((s) => s.id === activeStoreId)

  if (activeStore) return activeStore.id

  // Default to first store (don't set cookie here)
  return userStores[0].id
}

/**
 * Get the current user's role in the active store
 */
export async function getCurrentStoreRole(): Promise<MemberRole | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const userStores = await getUserStores()
  if (userStores.length === 0) return null

  const activeStoreId = await getActiveStoreId()
  const activeStore = userStores.find((s) => s.id === activeStoreId) || userStores[0]

  return activeStore.role
}

type Permission = 'read' | 'write' | 'delete' | 'manage_members' | 'manage_settings'

const ROLE_PERMISSIONS: Record<MemberRole, Permission[]> = {
  owner: ['read', 'write', 'delete', 'manage_members', 'manage_settings'],
  member: ['read', 'write'],
  platform_admin: ['read', 'write', 'delete', 'manage_members', 'manage_settings'],
}

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

/**
 * Check if the current user has a specific permission in the active store
 */
export async function currentUserHasPermission(permission: Permission): Promise<boolean> {
  const role = await getCurrentStoreRole()
  if (!role) return false
  return hasPermission(role, permission)
}

/**
 * Verify user has access to a specific store
 * Platform admins always have access with role 'platform_admin'
 */
export async function verifyStoreAccess(storeId: string): Promise<MemberRole | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  // Check natural membership first
  const membership = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, storeId),
      eq(storeMembers.userId, session.user.id)
    ),
  })

  if (membership) {
    return membership.role as MemberRole
  }

  // If no membership, check if user is platform admin
  if (isPlatformAdmin(session.user.email)) {
    // Verify the store exists
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: { id: true },
    })

    if (store) {
      return 'platform_admin'
    }
  }

  return null
}
