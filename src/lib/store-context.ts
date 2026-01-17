import { cookies } from 'next/headers'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { stores, storeMembers } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { StoreSettings, StoreTheme, EmailSettings, ReviewBoosterSettings } from '@/types/store'

const ACTIVE_STORE_COOKIE = 'louez_active_store'

export type MemberRole = 'owner' | 'member'

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
  settings: StoreSettings | null
  theme: StoreTheme | null
  cgv: string | null
  legalNotice: string | null
  stripeAccountId: string | null
  stripeOnboardingComplete: boolean | null
  stripeChargesEnabled: boolean | null
  emailSettings: EmailSettings | null
  reviewBoosterSettings: ReviewBoosterSettings | null
  icsToken: string | null
  onboardingCompleted: boolean | null
  createdAt: Date
  updatedAt: Date
  role: MemberRole
}

/**
 * Get all stores the current user has access to
 */
export async function getUserStores(): Promise<StoreWithRole[]> {
  const session = await auth()
  if (!session?.user?.id) return []

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
 */
export async function setActiveStoreId(storeId: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_STORE_COOKIE, storeId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  })
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
 */
export async function verifyStoreAccess(storeId: string): Promise<MemberRole | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const membership = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, storeId),
      eq(storeMembers.userId, session.user.id)
    ),
  })

  return membership?.role as MemberRole | null
}
