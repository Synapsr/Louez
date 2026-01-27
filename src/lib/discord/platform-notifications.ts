/**
 * Platform Admin Discord Notifications
 *
 * Sends single-line, real-time notifications to a platform-wide Discord channel.
 * Activated by setting the DISCORD_ADMIN_WEBHOOK_URL environment variable at runtime.
 *
 * This is separate from per-store Discord notifications (rich embeds configured
 * per store via discordWebhookUrl in the database). This system provides a global
 * activity feed for the platform operator.
 *
 * All functions are fire-and-forget: they never throw and never block the caller.
 */

import { db } from '@/lib/db'
import { subscriptions, storeMembers, stores } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

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
  return !!process.env.DISCORD_ADMIN_WEBHOOK_URL
}

/**
 * Send a plain-text message to the platform admin Discord webhook.
 * Returns immediately if DISCORD_ADMIN_WEBHOOK_URL is not set.
 */
async function send(message: string): Promise<void> {
  const webhookUrl = process.env.DISCORD_ADMIN_WEBHOOK_URL
  if (!webhookUrl) return

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message, username: 'Louez', flags: 4 }),
    })
  } catch {
    // Best-effort monitoring — never block the calling action
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
  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost:3000'
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
  if (!isEnabled()) return
  await send(`📧 Verification email sent to ${email}`)
}

export async function notifyStoreCreated(store: StoreInfo): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`🏪 ${prefix} completed onboarding`)
}

export async function notifyUserSignedIn(
  userId: string,
  email: string,
  method: 'magic link' | 'google'
): Promise<void> {
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
  if (!isEnabled()) return
  const link = storeLink(store.name, store.slug)
  await send(`⬆️ ${link} [${planLabel(planSlug)}] subscribed to ${planLabel(planSlug)} (${interval})`)
}

export async function notifySubscriptionCancelled(store: StoreInfo): Promise<void> {
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
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`✅ ${prefix} reservation #${reservationNumber} confirmed`)
}

export async function notifyReservationRejected(
  store: StoreInfo,
  reservationNumber: string
): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`🚫 ${prefix} reservation #${reservationNumber} rejected`)
}

export async function notifyReservationCancelled(
  store: StoreInfo,
  reservationNumber: string
): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`❌ ${prefix} reservation #${reservationNumber} cancelled`)
}

export async function notifyEquipmentPickedUp(
  store: StoreInfo,
  reservationNumber: string
): Promise<void> {
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
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`🏷️ ${prefix} new product: ${productName}`)
}

export async function notifyProductUpdated(
  store: StoreInfo,
  productName: string
): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`📝 ${prefix} updated product: ${productName}`)
}

export async function notifyCustomerCreated(
  store: StoreInfo,
  customer: { firstName: string; lastName: string; email: string }
): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`👤 ${prefix} new customer: ${customer.firstName} ${customer.lastName} (${customer.email})`)
}

export async function notifyTeamMemberInvited(
  store: StoreInfo,
  invitedEmail: string
): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`👥 ${prefix} invited ${invitedEmail} to the team`)
}

export async function notifyStripeConnected(store: StoreInfo): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`💳 ${prefix} connected Stripe account`)
}

export async function notifyStoreSettingsUpdated(store: StoreInfo): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`⚙️ ${prefix} updated store settings`)
}

export async function notifyNotificationSettingsUpdated(store: StoreInfo): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`🔔 ${prefix} updated notification settings`)
}

export async function notifySmsCreditsTopup(
  store: StoreInfo,
  quantity: number
): Promise<void> {
  if (!isEnabled()) return
  const prefix = await storePrefix(store)
  await send(`📱 ${prefix} purchased ${quantity} SMS credits`)
}
