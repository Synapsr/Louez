import { render } from '@react-email/render'
import { sendEmail } from './client'
import { db } from '@/lib/db'
import { emailLogs } from '@/lib/db/schema'
import { getEmailTranslations, type EmailLocale } from './i18n'
import {
  VerificationCodeEmail,
  ReservationConfirmationEmail,
  RequestReceivedEmail,
  RequestAcceptedEmail,
  RequestRejectedEmail,
  ReminderPickupEmail,
  ReminderReturnEmail,
  NewRequestLandlordEmail,
  TeamInvitationEmail,
  InstantAccessEmail,
  ThankYouReviewEmail,
} from './templates'

interface Store {
  id: string
  name: string
  logoUrl?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  theme?: {
    primaryColor?: string
  } | null
  settings?: {
    currency?: string
  } | null
  emailSettings?: {
    confirmationEnabled?: boolean
    reminderPickupEnabled?: boolean
    reminderReturnEnabled?: boolean
    replyToEmail?: string | null
    defaultSignature?: string
    confirmationContent?: import('@/types/store').EmailCustomContent
    rejectionContent?: import('@/types/store').EmailCustomContent
    pickupReminderContent?: import('@/types/store').EmailCustomContent
    returnReminderContent?: import('@/types/store').EmailCustomContent
    requestAcceptedContent?: import('@/types/store').EmailCustomContent
  } | null
}

interface Customer {
  firstName: string
  lastName: string
  email: string
}

interface ReservationItem {
  name: string
  quantity: number
  unitPrice: number
  totalPrice: number
}

// Log email in database
async function logEmail({
  storeId,
  reservationId,
  customerId,
  to,
  subject,
  templateType,
  status,
  messageId,
  error,
}: {
  storeId: string
  reservationId?: string
  customerId?: string
  to: string
  subject: string
  templateType: string
  status: 'sent' | 'failed'
  messageId?: string
  error?: string
}) {
  try {
    await db.insert(emailLogs).values({
      storeId,
      reservationId: reservationId || null,
      customerId: customerId || null,
      to,
      subject,
      templateType,
      status,
      messageId: messageId || null,
      error: error || null,
    })
  } catch (e) {
    console.error('Failed to log email:', e)
  }
}

// Verification Code Email
export async function sendVerificationCodeEmail({
  to,
  store,
  code,
  locale = 'fr',
}: {
  to: string
  store: Store
  code: string
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const subject = `${t.verificationCode.subject.replace('{code}', code)} - ${store.name}`
  const html = await render(
    VerificationCodeEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeEmail: store.email,
      storePhone: store.phone,
      code,
      locale,
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      to,
      subject,
      templateType: 'verification_code',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      to,
      subject,
      templateType: 'verification_code',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// Reservation Confirmation Email
export async function sendReservationConfirmationEmail({
  to,
  store,
  customer,
  reservation,
  items,
  reservationUrl,
  locale = 'fr',
}: {
  to: string
  store: Store
  customer: Customer
  reservation: {
    id: string
    number: string
    startDate: Date
    endDate: Date
    subtotalAmount: number
    depositAmount: number
    totalAmount: number
    // Tax info
    taxEnabled?: boolean
    taxRate?: number | null
    subtotalExclTax?: number | null
    taxAmount?: number | null
  }
  items: ReservationItem[]
  reservationUrl: string
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const customContent = store.emailSettings?.confirmationContent
  const subject = customContent?.subject
    ? customContent.subject.replace('{number}', reservation.number)
    : `${t.confirmReservation.subject.replace('{number}', reservation.number)} - ${store.name}`

  const html = await render(
    ReservationConfirmationEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeAddress: store.address,
      storePhone: store.phone,
      storeEmail: store.email,
      customerFirstName: customer.firstName,
      reservationNumber: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      items,
      subtotal: reservation.subtotalAmount,
      deposit: reservation.depositAmount,
      total: reservation.totalAmount,
      reservationUrl,
      customContent,
      locale,
      currency: store.settings?.currency || 'EUR',
      taxEnabled: reservation.taxEnabled,
      taxRate: reservation.taxRate,
      subtotalExclTax: reservation.subtotalExclTax,
      taxAmount: reservation.taxAmount,
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'reservation_confirmation',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'reservation_confirmation',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// Request Received Email
export async function sendRequestReceivedEmail({
  to,
  store,
  customer,
  reservation,
  locale = 'fr',
}: {
  to: string
  store: Store
  customer: Customer
  reservation: {
    id: string
    number: string
    startDate: Date
    endDate: Date
  }
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const subject = `${t.requestReceived.subject.replace('{number}', reservation.number)} - ${store.name}`
  const html = await render(
    RequestReceivedEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeEmail: store.email,
      storePhone: store.phone,
      storeAddress: store.address,
      customerFirstName: customer.firstName,
      reservationNumber: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      locale,
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'request_received',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'request_received',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// Request Accepted Email
export async function sendRequestAcceptedEmail({
  to,
  store,
  customer,
  reservation,
  items,
  reservationUrl,
  paymentUrl,
  locale = 'fr',
}: {
  to: string
  store: Store
  customer: Customer
  reservation: {
    id: string
    number: string
    startDate: Date
    endDate: Date
    totalAmount: number
  }
  items: { name: string; quantity: number; totalPrice: number }[]
  reservationUrl: string
  paymentUrl?: string | null
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const customContent = store.emailSettings?.requestAcceptedContent
  const subject = customContent?.subject
    ? customContent.subject.replace('{number}', reservation.number)
    : `${t.requestAccepted.subject.replace('{number}', reservation.number)} - ${store.name}`

  const html = await render(
    RequestAcceptedEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeAddress: store.address,
      storeEmail: store.email,
      storePhone: store.phone,
      customerFirstName: customer.firstName,
      reservationNumber: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      items,
      total: reservation.totalAmount,
      reservationUrl,
      paymentUrl,
      customContent,
      locale,
      currency: store.settings?.currency || 'EUR',
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'request_accepted',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'request_accepted',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// Request Rejected Email
export async function sendRequestRejectedEmail({
  to,
  store,
  customer,
  reservation,
  reason,
  locale = 'fr',
}: {
  to: string
  store: Store
  customer: Customer
  reservation: {
    id: string
    number: string
  }
  reason?: string | null
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const customContent = store.emailSettings?.rejectionContent
  const subject = customContent?.subject
    ? customContent.subject.replace('{number}', reservation.number)
    : `${t.requestRejected.subject.replace('{number}', reservation.number)} - ${store.name}`

  const html = await render(
    RequestRejectedEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeEmail: store.email,
      storePhone: store.phone,
      storeAddress: store.address,
      customerFirstName: customer.firstName,
      reservationNumber: reservation.number,
      reason,
      customContent,
      locale,
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'request_rejected',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'request_rejected',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// Reminder Pickup Email
export async function sendReminderPickupEmail({
  to,
  store,
  customer,
  reservation,
  reservationUrl,
  locale = 'fr',
}: {
  to: string
  store: Store
  customer: Customer
  reservation: {
    id: string
    number: string
    startDate: Date
  }
  reservationUrl: string
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const customContent = store.emailSettings?.pickupReminderContent
  const subject = customContent?.subject || `${t.reminderPickup.subject} - ${store.name}`

  const html = await render(
    ReminderPickupEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeAddress: store.address,
      storeEmail: store.email,
      storePhone: store.phone,
      customerFirstName: customer.firstName,
      reservationNumber: reservation.number,
      startDate: reservation.startDate,
      reservationUrl,
      customContent,
      locale,
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'reminder_pickup',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'reminder_pickup',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// Reminder Return Email
export async function sendReminderReturnEmail({
  to,
  store,
  customer,
  reservation,
  locale = 'fr',
}: {
  to: string
  store: Store
  customer: Customer
  reservation: {
    id: string
    number: string
    endDate: Date
  }
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const customContent = store.emailSettings?.returnReminderContent
  const subject = customContent?.subject || `${t.reminderReturn.subject} - ${store.name}`

  const html = await render(
    ReminderReturnEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeAddress: store.address,
      storeEmail: store.email,
      storePhone: store.phone,
      customerFirstName: customer.firstName,
      reservationNumber: reservation.number,
      endDate: reservation.endDate,
      customContent,
      locale,
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'reminder_return',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'reminder_return',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// New Request Notification to Landlord
export async function sendNewRequestLandlordEmail({
  to,
  store,
  customer,
  reservation,
  dashboardUrl,
  locale = 'fr',
}: {
  to: string
  store: Store
  customer: Customer
  reservation: {
    id: string
    number: string
    startDate: Date
    endDate: Date
    totalAmount: number
  }
  dashboardUrl: string
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const subject = t.newRequestLandlord.subject.replace('{number}', reservation.number)
  const html = await render(
    NewRequestLandlordEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      customerFirstName: customer.firstName,
      customerLastName: customer.lastName,
      customerEmail: customer.email,
      reservationNumber: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      total: reservation.totalAmount,
      dashboardUrl,
      locale,
      currency: store.settings?.currency || 'EUR',
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'new_request_landlord',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'new_request_landlord',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// Team Invitation Email
export async function sendTeamInvitationEmail({
  to,
  storeName,
  storeLogoUrl,
  inviterName,
  invitationUrl,
  locale = 'fr',
}: {
  to: string
  storeName: string
  storeLogoUrl?: string | null
  inviterName: string
  invitationUrl: string
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const subject = t.teamInvitation.subject.replace('{inviterName}', inviterName).replace('{storeName}', storeName)
  const html = await render(
    TeamInvitationEmail({
      storeName,
      storeLogoUrl,
      inviterName,
      invitationUrl,
      locale,
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    return { success: true, messageId: result.messageId }
  } catch (error) {
    console.error('Failed to send team invitation email:', error)
    throw error
  }
}

// Instant Access Email (for sending access links to customers)
export async function sendInstantAccessEmail({
  to,
  store,
  customer,
  reservation,
  items,
  accessUrl,
  showPaymentCta,
  locale = 'fr',
}: {
  to: string
  store: Store
  customer: Customer
  reservation: {
    id: string
    number: string
    startDate: Date
    endDate: Date
    totalAmount: number
  }
  items: { name: string; quantity: number; totalPrice: number }[]
  accessUrl: string
  showPaymentCta: boolean
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const subject = `${t.instantAccess.subject.replace('{number}', reservation.number)} - ${store.name}`

  const html = await render(
    InstantAccessEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeAddress: store.address,
      storePhone: store.phone,
      storeEmail: store.email,
      customerFirstName: customer.firstName,
      reservationNumber: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      items,
      totalAmount: reservation.totalAmount,
      accessUrl,
      showPaymentCta,
      locale,
      currency: store.settings?.currency || 'EUR',
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'instant_access',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'instant_access',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}

// Thank You Review Email
export async function sendThankYouReviewEmail({
  to,
  store,
  customer,
  reservation,
  reviewUrl,
  locale = 'fr',
}: {
  to: string
  store: {
    id: string
    name: string
    logoUrl?: string | null
    email?: string | null
    phone?: string | null
    address?: string | null
    theme?: { primaryColor?: string } | null
  }
  customer: { firstName: string }
  reservation: {
    id: string
    number: string
    startDate: Date
    endDate: Date
  }
  reviewUrl: string
  locale?: EmailLocale
}) {
  const t = getEmailTranslations(locale)
  const subject = `${t.thankYouReview.subject} - ${store.name}`

  const html = await render(
    ThankYouReviewEmail({
      storeName: store.name,
      logoUrl: store.logoUrl,
      primaryColor: store.theme?.primaryColor || '#0066FF',
      storeAddress: store.address,
      storePhone: store.phone,
      storeEmail: store.email,
      customerFirstName: customer.firstName,
      reservationNumber: reservation.number,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      reviewUrl,
      locale,
    })
  )

  try {
    const result = await sendEmail({ to, subject, html })
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'thank_you_review',
      status: 'sent',
      messageId: result.messageId,
    })
    return { success: true }
  } catch (error) {
    await logEmail({
      storeId: store.id,
      reservationId: reservation.id,
      to,
      subject,
      templateType: 'thank_you_review',
      status: 'failed',
      error: String(error),
    })
    throw error
  }
}
