/**
 * Platform Admin Notifications
 *
 * Sends real-time notifications to:
 * - Discord: single-line messages to a platform-wide channel (DISCORD_ADMIN_WEBHOOK_URL)
 * - fromHello: engagement events for user analytics and automation (FROMHELLO_API_URL)
 *
 * Both channels are optional and activated independently via environment variables.
 * This is separate from per-store Discord notifications (rich embeds configured
 * per store via discordWebhookUrl in the database).
 *
 * All functions are fire-and-forget: they never throw and never block the caller.
 */

import { db } from '@louez/db'
import { subscriptions, storeMembers, stores } from '@louez/db'
import { eq } from 'drizzle-orm'
import { env } from '@/env'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StoreInfo {
  id: string
  name: string
  slug: string
}

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/**
 * Check if platform notifications are enabled.
 * Use this to skip expensive work (DB queries, string building) when disabled.
 */
function isEnabled(): boolean {
  return !!env.DISCORD_ADMIN_WEBHOOK_URL
}

/**
 * Send a plain-text message to the platform admin Discord webhook.
 * Returns immediately if DISCORD_ADMIN_WEBHOOK_URL is not set.
 */
async function send(message: string): Promise<void> {
  if (!env.DISCORD_ADMIN_WEBHOOK_URL) return

  try {
    const res = await fetch(env.DISCORD_ADMIN_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message, username: 'Louez', flags: 4 }),
    })
    if (!res.ok) {
      console.error(`[Discord] Webhook returned ${res.status}: ${await res.text().catch(() => '')}`)
    }
  } catch (error) {
    console.error('[Discord] Webhook fetch failed:', error)
  }
}

// ---------------------------------------------------------------------------
// fromHello event tracking (server-side, fire-and-forget)
// ---------------------------------------------------------------------------

/**
 * Resolve the owner userId for a store. Returns undefined if not found.
 */
async function resolveStoreOwner(storeId: string): Promise<string | undefined> {
  try {
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: { userId: true },
    })
    return store?.userId
  } catch {
    return undefined
  }
}

async function trackFromHello(
  eventName: string,
  properties: Record<string, unknown> = {},
  options?: { externalId?: string; storeId?: string }
): Promise<void> {
  if (!env.FROMHELLO_API_URL || !env.FROMHELLO_API_KEY) return

  try {
    // Resolve externalId: use explicit value, or look up store owner.
    // The store owner's userId (Better Auth) is sent as fromHello's
    // externalId — fromHello find-or-creates a profile keyed on it.
    let externalId = options?.externalId
    if (!externalId && options?.storeId) {
      externalId = await resolveStoreOwner(options.storeId)
    }

    await fetch(`${env.FROMHELLO_API_URL}/api/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.FROMHELLO_API_KEY,
      },
      body: JSON.stringify({
        name: eventName,
        source: 'api',
        properties,
        ...(externalId && { externalId }),
      }),
    })
  } catch {
    // Fire-and-forget: never block the caller
  }
}

/**
 * Update profile attributes on fromHello, keyed by integrator-supplied
 * externalId. Hits the /by-external/ route, which find-or-creates the
 * profile so the first call from a previously-unknown user still works.
 * Fire-and-forget.
 */
async function setFromHelloProfile(
  externalId: string,
  attributes: Record<string, unknown>
): Promise<void> {
  if (!env.FROMHELLO_API_URL || !env.FROMHELLO_API_KEY) return

  try {
    await fetch(
      `${env.FROMHELLO_API_URL}/api/profiles/by-external/${encodeURIComponent(externalId)}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.FROMHELLO_API_KEY,
        },
        body: JSON.stringify(attributes),
      }
    )
  } catch {
    // Fire-and-forget
  }
}

/**
 * Get the current plan slug for a store.
 * Returns 'start' if no subscription exists.
 */
async function getPlanSlug(storeId: string): Promise<string> {
  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.storeId, storeId),
  })
  return sub?.planSlug || 'start'
}

/** Format a plan slug as a display label. */
function planLabel(slug: string): string {
  const labels: Record<string, string> = { start: 'Start', pro: 'Pro', ultra: 'Ultra' }
  return labels[slug] || 'Start'
}

/** Build a Discord markdown link to a store's storefront. */
function storeLink(name: string, slug: string): string {
  const domain = env.NEXT_PUBLIC_APP_DOMAIN
  const protocol = domain.includes('localhost') ? 'http' : 'https'
  return `[${name}](${protocol}://${slug}.${domain})`
}

/**
 * Build the store prefix used in most messages: [StoreName](url) [Plan]
 */
async function storePrefix(store: StoreInfo): Promise<string> {
  const plan = await getPlanSlug(store.id)
  return `${storeLink(store.name, store.slug)} [${planLabel(plan)}]`
}

// ---------------------------------------------------------------------------
// Tier 1 — Authentication & Account
// ---------------------------------------------------------------------------

export async function notifyVerificationEmailSent(email: string): Promise<void> {
  trackFromHello('verification_email_sent', { email }).catch(() => {})
  if (!isEnabled()) return
  await send(`📧 Verification email sent to ${email}`)
}

export async function notifyStoreCreated(store: StoreInfo): Promise<void> {
  trackFromHello('store_created', { storeName: store.name, storeSlug: store.slug }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`🏪 ${prefix} completed onboarding`)
}

export async function notifyUserSignedIn(
  userId: string,
  email: string,
  method: 'magic link' | 'google'
): Promise<void> {
  trackFromHello('user_signed_in', { email, method }, { externalId: userId }).catch(() => {})
  if (!isEnabled()) return

  // Resolve the user's primary store for context
  const membership = await db.query.storeMembers.findFirst({
    where: eq(storeMembers.userId, userId),
  })

  if (membership) {
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, membership.storeId),
    })
    if (store) {
      const prefix = await storePrefix({ id: store.id, name: store.name, slug: store.slug })
      await send(`🔑 ${prefix} signed in via ${method}`)
      return
    }
  }

  // No store yet (new user who hasn't completed onboarding)
  await send(`🔑 ${email} signed in via ${method}`)
}

// ---------------------------------------------------------------------------
// Tier 2 — Subscriptions
// ---------------------------------------------------------------------------

export async function notifySubscriptionActivated(
  store: StoreInfo,
  planSlug: string,
  interval: 'monthly' | 'yearly'
): Promise<void> {
  trackFromHello('subscription_activated', { storeName: store.name, plan: planSlug, interval }, { storeId: store.id }).catch(() => {})
  resolveStoreOwner(store.id).then((userId) => {
    if (userId) setFromHelloProfile(userId, { plan: planSlug, planInterval: interval })
  }).catch(() => {})
  if (!isEnabled()) return
  const link = storeLink(store.name, store.slug)
  await send(`⬆️ ${link} [${planLabel(planSlug)}] subscribed to ${planLabel(planSlug)} (${interval})`)
}

export async function notifySubscriptionCancelled(store: StoreInfo): Promise<void> {
  trackFromHello('subscription_cancelled', { storeName: store.name, storeSlug: store.slug }, { storeId: store.id }).catch(() => {})
  resolveStoreOwner(store.id).then((userId) => {
    if (userId) setFromHelloProfile(userId, { plan: 'cancelled', planInterval: null })
  }).catch(() => {})
  if (!isEnabled()) return
  const link = storeLink(store.name, store.slug)
  await send(`⬇️ ${link} [Start] subscription cancelled — downgraded to Start`)
}

// ---------------------------------------------------------------------------
// Tier 3 — Reservations
// ---------------------------------------------------------------------------

export async function notifyNewReservation(
  store: StoreInfo,
  reservation: { number: string; customerName: string; totalAmount: number; currency?: string }
): Promise<void> {
  trackFromHello('reservation_created', {
    storeName: store.name,
    reservationNumber: reservation.number,
    customerName: reservation.customerName,
    totalAmount: reservation.totalAmount,
    currency: reservation.currency || 'EUR',
  }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  const amount = reservation.totalAmount.toFixed(2)
  const currency = (reservation.currency || 'EUR').toUpperCase()
  await send(
    `📦 ${prefix} new reservation #${reservation.number} from ${reservation.customerName} — ${amount} ${currency}`
  )
}

export async function notifyReservationConfirmed(
  store: StoreInfo,
  reservationNumber: string
): Promise<void> {
  trackFromHello('reservation_confirmed', { storeName: store.name, reservationNumber }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`✅ ${prefix} reservation #${reservationNumber} confirmed`)
}

export async function notifyReservationRejected(
  store: StoreInfo,
  reservationNumber: string
): Promise<void> {
  trackFromHello('reservation_rejected', { storeName: store.name, reservationNumber }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`🚫 ${prefix} reservation #${reservationNumber} rejected`)
}

export async function notifyReservationCancelled(
  store: StoreInfo,
  reservationNumber: string
): Promise<void> {
  trackFromHello('reservation_cancelled', { storeName: store.name, reservationNumber }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`❌ ${prefix} reservation #${reservationNumber} cancelled`)
}

export async function notifyEquipmentPickedUp(
  store: StoreInfo,
  reservationNumber: string
): Promise<void> {
  trackFromHello('equipment_picked_up', { storeName: store.name, reservationNumber }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`📤 ${prefix} equipment picked up for #${reservationNumber}`)
}

export async function notifyReservationCompleted(
  store: StoreInfo,
  reservationNumber: string,
  totalAmount: number,
  currency?: string
): Promise<void> {
  trackFromHello('reservation_completed', {
    storeName: store.name,
    reservationNumber,
    totalAmount,
    currency: (currency || 'EUR').toUpperCase(),
  }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  const amount = totalAmount.toFixed(2)
  const cur = (currency || 'EUR').toUpperCase()
  await send(`🏁 ${prefix} reservation #${reservationNumber} completed — ${amount} ${cur}`)
}

// ---------------------------------------------------------------------------
// Tier 4 — Payments
// ---------------------------------------------------------------------------

export async function notifyPaymentReceived(
  store: StoreInfo,
  reservationNumber: string,
  amount: number,
  currency?: string
): Promise<void> {
  trackFromHello('payment_received', {
    storeName: store.name,
    reservationNumber,
    amount,
    currency: (currency || 'EUR').toUpperCase(),
  }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  const formatted = amount.toFixed(2)
  const cur = (currency || 'EUR').toUpperCase()
  await send(`💰 ${prefix} payment received for #${reservationNumber} — ${formatted} ${cur}`)
}

export async function notifyPaymentFailed(
  store: StoreInfo,
  reservationNumber: string
): Promise<void> {
  trackFromHello('payment_failed', { storeName: store.name, reservationNumber }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`⚠️ ${prefix} payment failed for #${reservationNumber}`)
}

// ---------------------------------------------------------------------------
// Tier 5 — Store Management
// ---------------------------------------------------------------------------

export async function notifyProductCreated(
  store: StoreInfo,
  productName: string
): Promise<void> {
  trackFromHello('product_created', { storeName: store.name, productName }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`🏷️ ${prefix} new product: ${productName}`)
}

export async function notifyProductUpdated(
  store: StoreInfo,
  productName: string
): Promise<void> {
  trackFromHello('product_updated', { storeName: store.name, productName }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`📝 ${prefix} updated product: ${productName}`)
}

export async function notifyCustomerCreated(
  store: StoreInfo,
  customer: { firstName: string; lastName: string; email: string }
): Promise<void> {
  trackFromHello('customer_created', {
    storeName: store.name,
    customerName: `${customer.firstName} ${customer.lastName}`,
    customerEmail: customer.email,
  }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`👤 ${prefix} new customer: ${customer.firstName} ${customer.lastName} (${customer.email})`)
}

export async function notifyTeamMemberInvited(
  store: StoreInfo,
  invitedEmail: string
): Promise<void> {
  trackFromHello('team_member_invited', { storeName: store.name, invitedEmail }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`👥 ${prefix} invited ${invitedEmail} to the team`)
}

export async function notifyStripeConnected(store: StoreInfo): Promise<void> {
  trackFromHello('stripe_connected', { storeName: store.name, storeSlug: store.slug }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`💳 ${prefix} connected Stripe account`)
}

export async function notifyStoreSettingsUpdated(store: StoreInfo): Promise<void> {
  trackFromHello('settings_updated', { storeName: store.name, storeSlug: store.slug }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`⚙️ ${prefix} updated store settings`)
}

export async function notifyNotificationSettingsUpdated(store: StoreInfo): Promise<void> {
  trackFromHello('notification_settings_updated', { storeName: store.name, storeSlug: store.slug }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`🔔 ${prefix} updated notification settings`)
}

export async function notifySmsCreditsTopup(
  store: StoreInfo,
  quantity: number
): Promise<void> {
  trackFromHello('sms_credits_purchased', { storeName: store.name, quantity }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`📱 ${prefix} purchased ${quantity} SMS credits`)
}

// ---------------------------------------------------------------------------
// Tier 6 — AI Chat
// ---------------------------------------------------------------------------

export async function notifyAiChatStarted(
  store: StoreInfo,
  prompt: string
): Promise<void> {
  trackFromHello('ai_chat_started', { storeName: store.name }, { storeId: store.id }).catch(() => {})
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  const truncated = prompt.length > 120 ? `${prompt.slice(0, 120)}…` : prompt
  await send(`🤖 ${prefix} new AI conversation: "${truncated}"`)
}

export async function notifyAiRateLimitHit(
  storeId: string,
  userId: string,
  window: 'minute' | 'hour' | 'day',
  count: number,
  limit: number
): Promise<void> {
  trackFromHello('ai_rate_limit_hit', { window, count, limit }, { externalId: userId, storeId }).catch(() => {})
  if (!isEnabled()) return

  try {
    const store = await db.query.stores.findFirst({
      where: eq(stores.id, storeId),
      columns: { id: true, name: true, slug: true },
    })
    if (!store) return

    const user = await db.query.storeMembers.findFirst({
      where: eq(storeMembers.userId, userId),
      columns: { userId: true },
    })

    const prefix = await storePrefix(store)
    await send(`🤖 ${prefix} AI rate limit hit — ${count}/${limit} per ${window} (user ${user?.userId ?? userId})`)
  } catch (error) {
    console.error('[Discord] AI rate limit notification failed:', error)
  }
}
