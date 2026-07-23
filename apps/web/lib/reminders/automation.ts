/**
 * Automatic Reminder Service
 *
 * Handles automatic sending of pickup and return reminders before reservations
 * start or end. Reminders are sent to two audiences, each with independent
 * timing and channel preferences:
 *  - customers (email / SMS) — from customerNotificationSettings
 *  - store admins/owners (email / SMS / Discord) — from notificationSettings
 *
 * Called by the cron job every minute to check for pending reminders.
 */

import { db } from '@louez/db'
import { reservations, customers, reminderLogs, adminDigestLogs } from '@louez/db'
import { eq, and, gte, lte, inArray } from 'drizzle-orm'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import { dispatchCustomerNotification } from '@/lib/notifications/customer-dispatcher'
import { dispatchAdminReminder, dispatchAdminDigest } from '@/lib/notifications/dispatcher'
import { getLocaleFromCountry } from '@/lib/email/i18n'
import { getStorefrontUrl } from '@/lib/storefront-url'
import { formatStoreDate } from '@/lib/utils/store-date'
import type { DigestEntry } from '@/lib/email/templates'
import {
  DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS,
  DEFAULT_NOTIFICATION_SETTINGS,
  type CustomerNotificationSettings,
  type NotificationSettings,
  type NotificationChannelConfig,
} from '@louez/types'
import { env } from '@/env'

interface ProcessResult {
  processed: number
  pickupRemindersSent: number
  returnRemindersSent: number
  adminPickupRemindersSent: number
  adminReturnRemindersSent: number
  adminDigestsSent: number
  errors: string[]
}

type ReminderType = 'pickup' | 'return'
type ReminderAudience = 'customer' | 'admin'
type ReminderChannel = 'email' | 'sms' | 'discord'

const DEFAULT_REMINDER_TIMING = { pickupReminderHours: 24, returnReminderHours: 24 }
const DIGEST_CHANNELS: ReminderChannel[] = ['email', 'sms', 'discord']

/** Store columns needed to dispatch reminders across every channel. */
type ReminderStore = {
  id: string
  slug: string
  name: string
  email: string | null
  logoUrl: string | null
  darkLogoUrl: string | null
  address: string | null
  phone: string | null
  ownerPhone: string | null
  discordWebhookUrl: string | null
  theme: unknown
  settings: unknown
  emailSettings: unknown
  customerNotificationSettings: unknown
  notificationSettings: unknown
}

type EligibleReservation = {
  reservation: typeof reservations.$inferSelect
  customer: typeof customers.$inferSelect
}

type ReminderWorkItem = EligibleReservation & {
  /** Channels already sent for this reservation on a previous run (per audience+type). */
  alreadySent: Set<ReminderChannel>
}

interface ReminderPass {
  type: ReminderType
  audience: ReminderAudience
  hoursBefore: number
}

/**
 * Process pending reminders for all stores.
 * This is called by the cron job (every minute).
 */
export async function processReminders(): Promise<ProcessResult> {
  const result: ProcessResult = {
    processed: 0,
    pickupRemindersSent: 0,
    returnRemindersSent: 0,
    adminPickupRemindersSent: 0,
    adminReturnRemindersSent: 0,
    adminDigestsSent: 0,
    errors: [],
  }

  try {
    // Fetch every store once with all the columns any reminder channel needs.
    // The reservation URL is built from store.slug here, so the per-reservation
    // slug lookup that used to run inside the send loop is gone.
    const allStores = await db.query.stores.findMany({
      columns: {
        id: true,
        slug: true,
        name: true,
        email: true,
        logoUrl: true,
        darkLogoUrl: true,
        address: true,
        phone: true,
        ownerPhone: true,
        discordWebhookUrl: true,
        theme: true,
        settings: true,
        emailSettings: true,
        customerNotificationSettings: true,
        notificationSettings: true,
      },
    })

    for (const store of allStores) {
      try {
        await processStoreReminders(store as ReminderStore, result)
      } catch (error) {
        result.errors.push(
          `Store ${store.id} reminder error: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
      result.processed++
    }
  } catch (error) {
    result.errors.push(`Global error: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }

  return result
}

/**
 * Process every enabled reminder pass for a single store.
 *
 * Each pass (customer/admin × pickup/return) has its own timing window, so they
 * are queried independently. Reads run in parallel; sends run sequentially to
 * respect the shared SMS quota and provider rate limits.
 */
async function processStoreReminders(store: ReminderStore, result: ProcessResult): Promise<void> {
  const customerSettings =
    (store.customerNotificationSettings as CustomerNotificationSettings) ||
    DEFAULT_CUSTOMER_NOTIFICATION_SETTINGS
  const adminSettings =
    (store.notificationSettings as NotificationSettings) || DEFAULT_NOTIFICATION_SETTINGS

  const customerTiming = customerSettings.reminderSettings ?? DEFAULT_REMINDER_TIMING
  const adminTiming = adminSettings.reminderSettings ?? DEFAULT_REMINDER_TIMING
  const adminMode = adminSettings.reminderSettings?.mode ?? 'per_reservation'

  // Cheap synchronous gating: only build a pass for audiences/types that are
  // actually enabled, so disabled paths never touch the database.
  const passes: ReminderPass[] = []

  if (isCustomerReminderEnabled(customerSettings.customer_reminder_pickup)) {
    passes.push({ type: 'pickup', audience: 'customer', hoursBefore: customerTiming.pickupReminderHours })
  }
  if (isCustomerReminderEnabled(customerSettings.customer_reminder_return)) {
    passes.push({ type: 'return', audience: 'customer', hoursBefore: customerTiming.returnReminderHours })
  }
  // Admin per-reservation reminders only run in 'per_reservation' mode; in
  // 'daily_digest' mode they are replaced by a single daily digest (below).
  if (adminMode === 'per_reservation') {
    if (anyChannelEnabled(adminSettings.reservation_reminder_pickup)) {
      passes.push({ type: 'pickup', audience: 'admin', hoursBefore: adminTiming.pickupReminderHours })
    }
    if (anyChannelEnabled(adminSettings.reservation_reminder_return)) {
      passes.push({ type: 'return', audience: 'admin', hoursBefore: adminTiming.returnReminderHours })
    }
  }

  // Gather worklists for every enabled pass in parallel (reads only, no sends).
  const worklists = await Promise.all(
    passes.map(async (pass) => {
      const eligible = await findEligibleReservations(store.id, pass.type, pass.hoursBefore)
      if (eligible.length === 0) return { pass, items: [] as ReminderWorkItem[] }

      const enabledChannels = enabledChannelsForPass(pass, customerSettings, adminSettings)
      const sentByReservation = await findAlreadyRemindedChannels(
        eligible.map((e) => e.reservation.id),
        pass.type,
        pass.audience
      )

      // Keep a reservation only while at least one enabled channel still needs
      // sending — dedup is per-channel, matching how rows are logged, so a
      // partially-sent reservation (e.g. email ok, SMS failed) is retried for
      // the missing channel instead of being abandoned.
      const items: ReminderWorkItem[] = []
      for (const e of eligible) {
        const alreadySent = sentByReservation.get(e.reservation.id) ?? new Set<ReminderChannel>()
        const hasPending = Array.from(enabledChannels).some((ch) => !alreadySent.has(ch))
        if (hasPending) items.push({ ...e, alreadySent })
      }
      return { pass, items }
    })
  )

  // Dispatch sequentially — concurrent sends would race on the SMS quota.
  for (const { pass, items } of worklists) {
    for (const item of items) {
      try {
        const sentChannels =
          pass.audience === 'customer'
            ? await sendCustomerReminder(store, customerSettings, pass.type, item)
            : await sendAdminReminder(store, adminSettings, pass.type, item)

        // Log each sent channel independently: a logging failure on one channel
        // must not prevent the others from being recorded (which would re-send them).
        for (const channel of sentChannels) {
          try {
            await logReminder(item.reservation.id, store.id, item.customer.id, pass.type, channel, pass.audience)
          } catch (logError) {
            result.errors.push(
              `Failed to log ${pass.audience} ${pass.type} ${channel} reminder for reservation ${item.reservation.number}: ${logError instanceof Error ? logError.message : 'Unknown'}`
            )
          }
        }

        recordSent(result, pass, sentChannels.length)
      } catch (error) {
        result.errors.push(
          `${pass.audience} ${pass.type} reminder error for reservation ${item.reservation.number}: ${error instanceof Error ? error.message : 'Unknown'}`
        )
      }
    }
  }

  // In digest mode, admins get one consolidated summary per day instead of the
  // per-reservation reminders above.
  if (adminMode === 'daily_digest') {
    await processAdminDigest(store, adminSettings, result)
  }
}

function isCustomerReminderEnabled(
  config: CustomerNotificationSettings['customer_reminder_pickup'] | undefined
): boolean {
  return Boolean(config?.enabled && (config.email || config.sms))
}

function anyChannelEnabled(config: NotificationChannelConfig | undefined): boolean {
  return Boolean(config && (config.email || config.sms || config.discord))
}

/** The set of channels enabled for a pass — used to know when a reservation is fully sent. */
function enabledChannelsForPass(
  pass: ReminderPass,
  customerSettings: CustomerNotificationSettings,
  adminSettings: NotificationSettings
): Set<ReminderChannel> {
  const channels = new Set<ReminderChannel>()
  if (pass.audience === 'customer') {
    const config =
      pass.type === 'pickup'
        ? customerSettings.customer_reminder_pickup
        : customerSettings.customer_reminder_return
    if (config?.email) channels.add('email')
    if (config?.sms) channels.add('sms')
  } else {
    const config =
      pass.type === 'pickup'
        ? adminSettings.reservation_reminder_pickup
        : adminSettings.reservation_reminder_return
    if (config?.email) channels.add('email')
    if (config?.sms) channels.add('sms')
    if (config?.discord) channels.add('discord')
  }
  return channels
}

function recordSent(result: ProcessResult, pass: ReminderPass, sent: number): void {
  if (pass.audience === 'customer') {
    if (pass.type === 'pickup') result.pickupRemindersSent += sent
    else result.returnRemindersSent += sent
  } else {
    if (pass.type === 'pickup') result.adminPickupRemindersSent += sent
    else result.adminReturnRemindersSent += sent
  }
}

/**
 * Find reservations whose pickup/return falls within ~1h of the target time
 * (now + hoursBefore). Pickup targets confirmed reservations about to start;
 * return targets ongoing rentals about to end.
 */
async function findEligibleReservations(
  storeId: string,
  type: ReminderType,
  hoursBefore: number
): Promise<EligibleReservation[]> {
  const now = new Date()
  const targetTime = new Date(now.getTime() + hoursBefore * 60 * 60 * 1000)
  const windowStart = new Date(targetTime.getTime() - 30 * 60 * 1000)
  const windowEnd = new Date(targetTime.getTime() + 30 * 60 * 1000)

  const status = type === 'pickup' ? 'confirmed' : 'ongoing'
  const dateColumn = type === 'pickup' ? reservations.startDate : reservations.endDate

  // Deterministic order so the LIMIT picks the earliest-due reservations first;
  // any overflow beyond 50 in one window is picked up on a later run (dedup
  // makes re-querying safe).
  return db
    .select({ reservation: reservations, customer: customers })
    .from(reservations)
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, storeId),
        eq(reservations.status, status),
        gte(dateColumn, windowStart),
        lte(dateColumn, windowEnd)
      )
    )
    .orderBy(dateColumn)
    .limit(50)
}

/**
 * For the given reservations, return a map of reservationId → set of channels
 * already logged for this type + audience, so each channel dedupes independently.
 */
async function findAlreadyRemindedChannels(
  reservationIds: string[],
  type: ReminderType,
  audience: ReminderAudience
): Promise<Map<string, Set<ReminderChannel>>> {
  const existing = await db.query.reminderLogs.findMany({
    where: and(
      inArray(reminderLogs.reservationId, reservationIds),
      eq(reminderLogs.type, type),
      eq(reminderLogs.audience, audience)
    ),
  })

  const map = new Map<string, Set<ReminderChannel>>()
  for (const log of existing) {
    let set = map.get(log.reservationId)
    if (!set) {
      set = new Set<ReminderChannel>()
      map.set(log.reservationId, set)
    }
    set.add(log.channel as ReminderChannel)
  }
  return map
}

/**
 * Send a customer reminder for the channels not already sent.
 * Returns the channels that were sent on this run.
 */
async function sendCustomerReminder(
  store: ReminderStore,
  settings: CustomerNotificationSettings,
  type: ReminderType,
  { reservation, customer, alreadySent }: ReminderWorkItem
): Promise<ReminderChannel[]> {
  const eventType = type === 'pickup' ? 'customer_reminder_pickup' : 'customer_reminder_return'
  const reservationUrl = store.slug
    ? getStorefrontUrl(store.slug, `/account/reservations/${reservation.id}`)
    : ''

  // Forward settings with already-sent channels turned off so the dispatcher
  // only attempts the channels still pending for this reservation.
  const baseConfig = settings[eventType]
  const adjustedSettings: CustomerNotificationSettings = {
    ...settings,
    [eventType]: {
      ...baseConfig,
      email: baseConfig.email && !alreadySent.has('email'),
      sms: baseConfig.sms && !alreadySent.has('sms'),
    },
  }

  const dispatchResult = await dispatchCustomerNotification(eventType, {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      logoUrl: store.logoUrl,
      darkLogoUrl: store.darkLogoUrl,
      address: store.address,
      phone: store.phone,
      theme: store.theme as { mode?: 'light' | 'dark'; primaryColor?: string } | null,
      settings: store.settings as { country?: string; currency?: string } | null,
      emailSettings: store.emailSettings as Record<string, unknown> | null,
      customerNotificationSettings: adjustedSettings,
    },
    customer: {
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
    },
    reservation: {
      id: reservation.id,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: Number(reservation.totalAmount),
      subtotalAmount: Number(reservation.subtotalAmount),
      depositAmount: Number(reservation.depositAmount),
    },
    reservationUrl,
  })

  const sent: ReminderChannel[] = []
  if (dispatchResult.email.sent) sent.push('email')
  if (dispatchResult.sms.sent) sent.push('sms')
  return sent
}

/**
 * Send an admin reminder for the channels not already sent.
 * Returns the channels that were sent on this run.
 */
async function sendAdminReminder(
  store: ReminderStore,
  adminSettings: NotificationSettings,
  type: ReminderType,
  { reservation, customer, alreadySent }: ReminderWorkItem
): Promise<ReminderChannel[]> {
  const eventType =
    type === 'pickup' ? 'reservation_reminder_pickup' : 'reservation_reminder_return'
  const dashboardUrl = `${env.NEXT_PUBLIC_APP_URL}/dashboard/reservations/${reservation.id}`

  // Forward settings with already-sent channels turned off so the dispatcher
  // only attempts the channels still pending for this reservation.
  const baseConfig = adminSettings[eventType] ?? { email: false, sms: false, discord: false, push: false }
  const adjustedSettings: NotificationSettings = {
    ...adminSettings,
    [eventType]: {
      email: baseConfig.email && !alreadySent.has('email'),
      sms: baseConfig.sms && !alreadySent.has('sms'),
      discord: baseConfig.discord && !alreadySent.has('discord'),
      push: baseConfig.push,
    },
  }

  const dispatchResult = await dispatchAdminReminder(eventType, {
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      logoUrl: store.logoUrl,
      darkLogoUrl: store.darkLogoUrl,
      address: store.address,
      phone: store.phone,
      ownerPhone: store.ownerPhone,
      discordWebhookUrl: store.discordWebhookUrl,
      theme: store.theme as { mode?: 'light' | 'dark'; primaryColor?: string } | null,
      notificationSettings: adjustedSettings,
      settings: store.settings as { currency?: string; country?: string; timezone?: string } | null,
    },
    reservation: {
      id: reservation.id,
      number: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      totalAmount: Number(reservation.totalAmount),
    },
    customer: {
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
    },
    dashboardUrl,
  })

  const sent: ReminderChannel[] = []
  if (dispatchResult.email.sent) sent.push('email')
  if (dispatchResult.sms.sent) sent.push('sms')
  if (dispatchResult.discord.sent) sent.push('discord')
  return sent
}

/** Record that a reminder channel was sent so it is not sent again (idempotent). */
async function logReminder(
  reservationId: string,
  storeId: string,
  customerId: string,
  type: ReminderType,
  channel: ReminderChannel,
  audience: ReminderAudience
): Promise<void> {
  await db
    .insert(reminderLogs)
    .values({ reservationId, storeId, customerId, type, channel, audience })
    .onDuplicateKeyUpdate({ set: { sentAt: new Date() } })
}

// ============================================================================
// Daily admin digest
// ============================================================================

/**
 * Send the once-a-day admin digest for a store, if it's past the configured
 * send hour (store-local) and hasn't already gone out today. Channels dedupe
 * independently, like the per-reservation reminders.
 */
async function processAdminDigest(
  store: ReminderStore,
  adminSettings: NotificationSettings,
  result: ProcessResult
): Promise<void> {
  const pickupConfig = adminSettings.reservation_reminder_pickup
  const returnConfig = adminSettings.reservation_reminder_return

  // Channels enabled for the digest = union across pickup + return reminders.
  const enabled = {
    email: Boolean(pickupConfig?.email || returnConfig?.email),
    sms: Boolean(pickupConfig?.sms || returnConfig?.sms),
    discord: Boolean(pickupConfig?.discord || returnConfig?.discord),
  }
  if (!enabled.email && !enabled.sms && !enabled.discord) return

  const storeSettings = store.settings as { timezone?: string; country?: string } | null
  // Resolve to a valid IANA zone (or UTC) so the date-fns-tz calls below can't
  // throw on a corrupt timezone string and abort the digest.
  const timezone = resolveTimezone(storeSettings?.timezone)
  const digestHour = adminSettings.reminderSettings?.digestHour ?? 8

  const now = new Date()
  const localHour = Number(formatInTimeZone(now, timezone, 'HH'))
  // Fire once the store-local clock has reached the send hour; dedup keeps it to
  // a single send even though the cron re-checks every minute until midnight.
  if (!Number.isFinite(localHour) || localHour < digestHour) return

  const digestDate = formatInTimeZone(now, timezone, 'yyyy-MM-dd')

  const alreadySent = await findDigestSentChannels(store.id, digestDate)
  const pending = {
    email: enabled.email && !alreadySent.has('email'),
    sms: enabled.sms && !alreadySent.has('sms'),
    discord: enabled.discord && !alreadySent.has('discord'),
  }
  if (!pending.email && !pending.sms && !pending.discord) return

  // Bounds of the store-local calendar day, as UTC instants for the query.
  const dayStart = fromZonedTime(`${digestDate}T00:00:00.000`, timezone)
  const dayEnd = fromZonedTime(`${digestDate}T23:59:59.999`, timezone)

  const includePickups = anyChannelEnabled(pickupConfig)
  const includeReturns = anyChannelEnabled(returnConfig)
  const [pickupRows, returnRows] = await Promise.all([
    includePickups ? findDigestReservations(store.id, 'pickup', dayStart, dayEnd) : Promise.resolve([]),
    includeReturns ? findDigestReservations(store.id, 'return', dayStart, dayEnd) : Promise.resolve([]),
  ])

  // Nothing today — skip without marking, so a reservation confirmed later today
  // can still trigger the digest.
  if (pickupRows.length === 0 && returnRows.length === 0) return

  const locale = getLocaleFromCountry(storeSettings?.country)
  const toEntry = (row: DigestReservationRow): DigestEntry => ({
    number: row.number,
    customerName: `${row.firstName} ${row.lastName}`.trim(),
    timeLabel: formatStoreDate(row.date, timezone, 'TIME_ONLY', locale),
  })
  const pickups = pickupRows.map(toEntry)
  const returns = returnRows.map(toEntry)

  // Reserve-then-send: write each pending channel's dedup row BEFORE dispatching.
  // This makes the send idempotent — a crash or a failed log-write can never
  // cause a re-send (which, for SMS, would re-charge a credit every minute until
  // store-local midnight). Channels that don't actually go out are released so
  // they retry on the next tick.
  const claimedChannels: ReminderChannel[] = []
  for (const channel of DIGEST_CHANNELS) {
    if (!pending[channel]) continue
    if (await claimDigestChannel(store.id, digestDate, channel)) {
      claimedChannels.push(channel)
    }
  }
  if (claimedChannels.length === 0) return

  const dispatchResult = await dispatchAdminDigest({
    store: {
      id: store.id,
      name: store.name,
      email: store.email,
      logoUrl: store.logoUrl,
      darkLogoUrl: store.darkLogoUrl,
      address: store.address,
      phone: store.phone,
      ownerPhone: store.ownerPhone,
      discordWebhookUrl: store.discordWebhookUrl,
      theme: store.theme as { mode?: 'light' | 'dark'; primaryColor?: string } | null,
      settings: store.settings as { currency?: string; country?: string; timezone?: string } | null,
    },
    dateLabel: formatStoreDate(now, timezone, 'FULL_DATE', locale),
    pickups,
    returns,
    dashboardUrl: `${env.NEXT_PUBLIC_APP_URL}/dashboard/calendar`,
    channels: {
      email: claimedChannels.includes('email'),
      sms: claimedChannels.includes('sms'),
      discord: claimedChannels.includes('discord'),
    },
  })

  // Count one digest per store/day regardless of how many channels it went out
  // on; release any channel that didn't actually send so it retries next tick.
  let anyChannelSent = false
  for (const channel of claimedChannels) {
    if (dispatchResult[channel].sent) {
      anyChannelSent = true
    } else {
      // Didn't actually send — release this channel's claim so it retries next tick.
      await releaseDigestChannel(store.id, digestDate, channel).catch((releaseError) => {
        result.errors.push(
          `Failed to release admin digest ${channel} for store ${store.id}: ${releaseError instanceof Error ? releaseError.message : 'Unknown'}`
        )
      })
    }
  }
  if (anyChannelSent) result.adminDigestsSent += 1
}

type DigestReservationRow = {
  number: string
  date: Date
  firstName: string
  lastName: string
}

/** Channels for which today's digest has already been sent (per store/day). */
async function findDigestSentChannels(
  storeId: string,
  digestDate: string
): Promise<Set<ReminderChannel>> {
  const existing = await db.query.adminDigestLogs.findMany({
    where: and(eq(adminDigestLogs.storeId, storeId), eq(adminDigestLogs.digestDate, digestDate)),
  })
  return new Set(existing.map((l) => l.channel as ReminderChannel))
}

/** Reservations whose pickup/return falls on the given (store-local) day. */
async function findDigestReservations(
  storeId: string,
  type: ReminderType,
  dayStart: Date,
  dayEnd: Date
): Promise<DigestReservationRow[]> {
  const dateColumn = type === 'pickup' ? reservations.startDate : reservations.endDate

  // A daily "schedule" summary should show every active reservation due that
  // day, regardless of whether it's already been handed over. So include both
  // 'confirmed' (not yet picked up) and 'ongoing' (picked up) — a same-day
  // pickup already collected still belongs in the day's pickups, and a rental
  // due back today that hasn't been picked up yet still belongs in the returns.
  return db
    .select({
      number: reservations.number,
      date: dateColumn,
      firstName: customers.firstName,
      lastName: customers.lastName,
    })
    .from(reservations)
    .innerJoin(customers, eq(customers.id, reservations.customerId))
    .where(
      and(
        eq(reservations.storeId, storeId),
        inArray(reservations.status, ['confirmed', 'ongoing']),
        gte(dateColumn, dayStart),
        lte(dateColumn, dayEnd)
      )
    )
    .orderBy(dateColumn)
    .limit(500)
}

/**
 * Reserve a digest channel for the day by writing its dedup row up front.
 * Returns true if newly reserved (safe to send), false if it already exists
 * (already sent, or a concurrent run claimed it) or the write failed — in which
 * case it's left unsent and retried on the next tick.
 */
async function claimDigestChannel(
  storeId: string,
  digestDate: string,
  channel: ReminderChannel
): Promise<boolean> {
  try {
    await db.insert(adminDigestLogs).values({ storeId, digestDate, channel })
    return true
  } catch {
    // Unique-constraint violation (already claimed) or a transient write error;
    // either way, don't send now — a transient error retries next tick.
    return false
  }
}

/** Undo a digest reservation when its send didn't go through, so it retries. */
async function releaseDigestChannel(
  storeId: string,
  digestDate: string,
  channel: ReminderChannel
): Promise<void> {
  await db
    .delete(adminDigestLogs)
    .where(
      and(
        eq(adminDigestLogs.storeId, storeId),
        eq(adminDigestLogs.digestDate, digestDate),
        eq(adminDigestLogs.channel, channel)
      )
    )
}

/** Validate an IANA timezone string, falling back to UTC if it's missing/invalid. */
function resolveTimezone(timezone: string | undefined | null): string {
  if (!timezone) return 'UTC'
  try {
    // Throws RangeError for an unknown/invalid IANA zone.
    Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return timezone
  } catch {
    return 'UTC'
  }
}
