import { getCustomerReminderPreferences } from "./customer-reminder-preferences";
import {
  isCustomerReminder,
  resolveCustomerReminderChannels,
} from "./util.customer-reminder-preferences";
/**
 * Customer Notification Dispatcher
 *
 * Handles sending notifications (email/SMS) to customers based on store preferences.
 * Respects customer notification settings and uses the language saved with the reservation.
 */

import { db, reservations } from "@louez/db";
import { and, eq } from "drizzle-orm";

import { resolveReservationEmailLocale, type EmailLocale } from "@/lib/email/i18n";
import {
  sendRequestReceivedEmail,
  sendRequestAcceptedEmail,
  sendRequestRejectedEmail,
  sendReservationConfirmationEmail,
  sendReservationCancelledEmail,
  sendReminderPickupEmail,
  sendReminderReturnEmail,
  sendPaymentRequestEmail,
  sendDepositAuthorizationRequestEmail,
  sendQuoteSentEmail,
} from "@/lib/email/send";
import {
  sendReservationConfirmationSms,
  sendReminderPickupSms,
  sendReminderReturnSms,
  sendRequestReceivedSms,
  sendRequestAcceptedSms,
  sendRequestRejectedSms,
  sendReservationCancelledSms,
  sendPaymentRequestSms,
  sendDepositAuthorizationRequestSms,
} from "@/lib/sms/send";
import { getSmsQuotaStatus } from "@/lib/plan-limits";
import type { EmailAttachment } from "@/lib/email/client";
import {
  withCustomerNotificationDefaults,
  type CustomerNotificationEventType,
  type CustomerNotificationSettings,
  type CustomerNotificationTemplate,
} from "@louez/types";

export interface CustomerNotificationStore {
  id: string;
  name: string;
  email?: string | null;
  logoUrl?: string | null;
  darkLogoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  theme?: { mode?: "light" | "dark"; primaryColor?: string } | null;
  settings?: { country?: string; currency?: string; timezone?: string } | null;
  emailSettings?: {
    confirmationContent?: {
      subject?: string;
      greeting?: string;
      message?: string;
      signature?: string;
    };
    rejectionContent?: {
      subject?: string;
      greeting?: string;
      message?: string;
      signature?: string;
    };
    requestAcceptedContent?: {
      subject?: string;
      greeting?: string;
      message?: string;
      signature?: string;
    };
    requestReceivedContent?: {
      subject?: string;
      greeting?: string;
      message?: string;
      signature?: string;
    };
    pickupReminderContent?: {
      subject?: string;
      greeting?: string;
      message?: string;
      signature?: string;
    };
    returnReminderContent?: {
      subject?: string;
      greeting?: string;
      message?: string;
      signature?: string;
    };
  } | null;
  customerNotificationSettings?: CustomerNotificationSettings | null;
}

export interface CustomerNotificationCustomer {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
}

export interface CustomerNotificationReservation {
  id: string;
  number: string;
  startDate: Date;
  endDate: Date;
  totalAmount: number;
  subtotalAmount: number;
  depositAmount: number;
  taxEnabled?: boolean;
  taxRate?: number | null;
  subtotalExclTax?: number | null;
  taxAmount?: number | null;
  /**
   * The reservation's language, when the caller froze it with the message
   * (an outbox row); otherwise it is read from the reservation.
   */
  locale?: string | null;
}

export interface CustomerNotificationContext {
  store: CustomerNotificationStore;
  customer: CustomerNotificationCustomer;
  reservation: CustomerNotificationReservation;
  items?: Array<{ name: string; quantity: number; unitPrice: number; totalPrice: number }>;
  reservationUrl?: string;
  /** The online store's home page, linked from a cancellation. */
  storefrontUrl?: string;
  contractUrl?: string;
  termsUrl?: string | null;
  paymentUrl?: string | null;
  reason?: string | null;
  // Payment request specific fields
  paymentRequestAmount?: number;
  paymentRequestDescription?: string;
  paymentRequestUrl?: string;
  customMessage?: string;
  // Deposit authorization specific fields
  depositAuthorizationAmount?: number;
  depositAuthorizationUrl?: string;
  documentAttachments?: EmailAttachment[];
  contractSignatureUrl?: string;
}

export interface CustomerNotificationResult {
  email: { sent: boolean; error?: string; skipped?: boolean };
  sms: { sent: boolean; error?: string; skipped?: boolean; limitReached?: boolean };
}

/**
 * Merge custom template with legacy emailSettings for backward compatibility
 */
function mergeTemplateWithLegacy(
  eventType: CustomerNotificationEventType,
  customTemplate: CustomerNotificationTemplate | undefined,
  emailSettings: CustomerNotificationStore["emailSettings"],
): { subject?: string; greeting?: string; message?: string; signature?: string } | undefined {
  // Map new event types to legacy emailSettings keys
  const legacyKeyMap: Record<
    CustomerNotificationEventType,
    keyof NonNullable<CustomerNotificationStore["emailSettings"]> | null
  > = {
    customer_request_received: "requestReceivedContent",
    customer_request_accepted: "requestAcceptedContent",
    customer_request_rejected: "rejectionContent",
    customer_reservation_confirmed: "confirmationContent",
    customer_reservation_cancelled: null, // No legacy mapping
    customer_reminder_pickup: "pickupReminderContent",
    customer_reminder_return: "returnReminderContent",
    customer_payment_requested: null, // No legacy mapping
    customer_deposit_authorization_requested: null, // No legacy mapping
    customer_quote_sent: null, // No legacy mapping
    customer_quote_accepted: null, // No legacy mapping
  };

  const legacyKey = legacyKeyMap[eventType];
  const legacyContent = legacyKey ? emailSettings?.[legacyKey] : undefined;

  // If we have new custom template, use it
  if (customTemplate) {
    return {
      subject: customTemplate.subject,
      message: customTemplate.emailMessage,
    };
  }

  // Fall back to legacy emailSettings
  return legacyContent;
}

/**
 * Dispatch a customer notification based on event type and store preferences
 */
export async function dispatchCustomerNotification(
  eventType: CustomerNotificationEventType,
  ctx: CustomerNotificationContext,
): Promise<CustomerNotificationResult> {
  const result: CustomerNotificationResult = {
    email: { sent: false },
    sms: { sent: false },
  };

  // Preferences, with the default of an event the saved settings predate
  const settings = withCustomerNotificationDefaults(ctx.store.customerNotificationSettings);
  const prefs = settings[eventType];

  // Skip if notification type is disabled
  if (!prefs?.enabled) {
    result.email.skipped = true;
    result.sms.skipped = true;
    return result;
  }

  const reservationLocale =
    ctx.reservation.locale !== undefined
      ? ctx.reservation.locale
      : (
          await db.query.reservations.findFirst({
            where: and(
              eq(reservations.id, ctx.reservation.id),
              eq(reservations.storeId, ctx.store.id),
            ),
            columns: { locale: true },
          })
        )?.locale;
  const locale = resolveReservationEmailLocale(reservationLocale, ctx.store.settings?.country);

  const customerPreferences = isCustomerReminder(eventType)
    ? await getCustomerReminderPreferences(ctx.store.id, ctx.customer.id)
    : null;
  const channels = resolveCustomerReminderChannels(eventType, prefs, customerPreferences);

  // Get custom template if any, with backward compatibility
  const customTemplate = settings.templates?.[eventType];
  const mergedContent = mergeTemplateWithLegacy(eventType, customTemplate, ctx.store.emailSettings);

  // Send email if enabled
  if (channels.email && ctx.customer.email) {
    try {
      await sendCustomerEmail(eventType, ctx, locale, mergedContent);
      result.email.sent = true;
    } catch (error) {
      result.email.error = error instanceof Error ? error.message : "Unknown error";
      console.error(`Failed to send customer email for ${eventType}:`, error);
    }
  } else if (!channels.email) {
    result.email.skipped = true;
  }

  // Send SMS if enabled
  if (channels.sms && ctx.customer.phone) {
    // Check quota first
    const quota = await getSmsQuotaStatus(ctx.store.id);
    if (!quota.allowed) {
      result.sms.limitReached = true;
      result.sms.error = "SMS limit reached";
    } else {
      try {
        const sent: unknown = await sendCustomerSms(eventType, ctx, locale, customTemplate);
        // The SMS senders answer a failure instead of throwing it.
        if (sent && typeof sent === "object" && "success" in sent && sent.success === false) {
          const error = "error" in sent && typeof sent.error === "string" ? sent.error : "";
          throw new Error(error || "The SMS was not sent.");
        }
        result.sms.sent = true;
      } catch (error) {
        result.sms.error = error instanceof Error ? error.message : "Unknown error";
        console.error(`Failed to send customer SMS for ${eventType}:`, error);
      }
    }
  } else if (!channels.sms) {
    result.sms.skipped = true;
  }

  return result;
}

/**
 * One channel of a customer notification, for an outbox row whose channel the
 * write already chose (packages/api platform/effects.ts). Unlike
 * `dispatchCustomerNotification`, it throws when the message did not go out,
 * so the row is retried, and answers `skipped` when it cannot go out at all
 * (no address, the store's SMS quota spent). `beforeSend` runs right before
 * the provider is called.
 */
export async function sendCustomerNotificationChannel(
  eventType: CustomerNotificationEventType,
  ctx: CustomerNotificationContext,
  channel: "email" | "sms",
  beforeSend: () => Promise<void>,
): Promise<{ skipped: string } | undefined> {
  const settings = withCustomerNotificationDefaults(ctx.store.customerNotificationSettings);
  const locale = resolveReservationEmailLocale(
    ctx.reservation.locale ?? null,
    ctx.store.settings?.country,
  );
  const customTemplate = settings.templates?.[eventType];

  if (channel === "email") {
    if (!ctx.customer.email) return { skipped: "the customer has no email" };
    const mergedContent = mergeTemplateWithLegacy(
      eventType,
      customTemplate,
      ctx.store.emailSettings,
    );
    await beforeSend();
    await sendCustomerEmail(eventType, ctx, locale, mergedContent);
    return undefined;
  }

  if (!ctx.customer.phone) return { skipped: "the customer has no phone" };
  const quota = await getSmsQuotaStatus(ctx.store.id);
  if (!quota.allowed) return { skipped: "the store's SMS limit is reached" };
  await beforeSend();
  const result: unknown = await sendCustomerSms(eventType, ctx, locale, customTemplate);
  if (result && typeof result === "object" && "success" in result && result.success === false) {
    const error = "error" in result && typeof result.error === "string" ? result.error : "";
    throw new Error(error || "The SMS was not sent.");
  }
  return undefined;
}

/**
 * Send customer email based on event type
 */
async function sendCustomerEmail(
  eventType: CustomerNotificationEventType,
  ctx: CustomerNotificationContext,
  locale: EmailLocale,
  customContent?: { subject?: string; greeting?: string; message?: string; signature?: string },
) {
  const emailParams = {
    to: ctx.customer.email,
    store: {
      ...ctx.store,
      emailSettings: ctx.store.emailSettings
        ? {
            ...ctx.store.emailSettings,
            // Inject custom content for the specific template
            ...(eventType === "customer_request_received" && {
              requestReceivedContent: customContent,
            }),
            ...(eventType === "customer_request_accepted" && {
              requestAcceptedContent: customContent,
            }),
            ...(eventType === "customer_request_rejected" && { rejectionContent: customContent }),
            ...(eventType === "customer_reservation_confirmed" && {
              confirmationContent: customContent,
            }),
            ...(eventType === "customer_reminder_pickup" && {
              pickupReminderContent: customContent,
            }),
            ...(eventType === "customer_reminder_return" && {
              returnReminderContent: customContent,
            }),
          }
        : undefined,
    },
    customer: ctx.customer,
    reservation: ctx.reservation,
    locale,
  };

  switch (eventType) {
    case "customer_request_received":
      return sendRequestReceivedEmail(emailParams);

    case "customer_request_accepted":
      return sendRequestAcceptedEmail({
        ...emailParams,
        items: ctx.items || [],
        reservationUrl: ctx.reservationUrl || "",
        contractUrl: ctx.contractUrl || "",
        termsUrl: ctx.termsUrl,
        paymentUrl: ctx.paymentUrl,
      });

    case "customer_request_rejected":
      return sendRequestRejectedEmail({
        ...emailParams,
        reason: ctx.reason,
      });

    case "customer_reservation_confirmed":
      return sendReservationConfirmationEmail({
        ...emailParams,
        items: ctx.items || [],
        reservationUrl: ctx.reservationUrl || "",
        documentAttachments: ctx.documentAttachments,
        contractSignatureUrl: ctx.contractSignatureUrl,
      });

    case "customer_reservation_cancelled":
      return sendReservationCancelledEmail({
        ...emailParams,
        items: ctx.items || [],
        storefrontUrl: ctx.storefrontUrl,
        customContent,
      });

    case "customer_reminder_pickup":
      return sendReminderPickupEmail({
        ...emailParams,
        reservationUrl: ctx.reservationUrl || "",
        contractSignatureUrl: ctx.contractSignatureUrl,
      });

    case "customer_reminder_return":
      return sendReminderReturnEmail(emailParams);

    case "customer_payment_requested":
      if (!ctx.paymentRequestAmount || !ctx.paymentRequestDescription || !ctx.paymentRequestUrl) {
        throw new Error("Payment request context missing required fields");
      }
      return sendPaymentRequestEmail({
        to: ctx.customer.email,
        store: ctx.store,
        customer: ctx.customer,
        reservation: ctx.reservation,
        amount: ctx.paymentRequestAmount,
        description: ctx.paymentRequestDescription,
        paymentUrl: ctx.paymentRequestUrl,
        customMessage: ctx.customMessage,
        locale,
      });

    case "customer_deposit_authorization_requested":
      if (!ctx.depositAuthorizationAmount || !ctx.depositAuthorizationUrl) {
        throw new Error("Deposit authorization context missing required fields");
      }
      return sendDepositAuthorizationRequestEmail({
        to: ctx.customer.email,
        store: ctx.store,
        customer: ctx.customer,
        reservation: ctx.reservation,
        depositAmount: ctx.depositAuthorizationAmount,
        authorizationUrl: ctx.depositAuthorizationUrl,
        customMessage: ctx.customMessage,
        locale,
      });

    case "customer_quote_sent":
      return sendQuoteSentEmail({
        to: ctx.customer.email,
        store: ctx.store,
        customer: ctx.customer,
        reservation: {
          id: ctx.reservation.id,
          number: ctx.reservation.number,
          startDate: ctx.reservation.startDate,
          endDate: ctx.reservation.endDate,
          totalAmount: ctx.reservation.totalAmount,
        },
        items: (ctx.items || []).map((item) => ({
          name: item.name,
          quantity: item.quantity,
          totalPrice: item.totalPrice,
        })),
        reservationUrl: ctx.reservationUrl || "",
        locale,
      });

    case "customer_quote_accepted":
      // Re-use request accepted email for quote accepted (same content: confirmed reservation)
      return sendRequestAcceptedEmail({
        ...emailParams,
        items: ctx.items || [],
        reservationUrl: ctx.reservationUrl || "",
        contractUrl: ctx.contractUrl || "",
        termsUrl: ctx.termsUrl,
        paymentUrl: ctx.paymentUrl,
      });

    default:
      throw new Error(`Unknown customer notification event type: ${eventType}`);
  }
}

/**
 * Send customer SMS based on event type
 */
async function sendCustomerSms(
  eventType: CustomerNotificationEventType,
  ctx: CustomerNotificationContext,
  _locale: EmailLocale,
  _customTemplate?: CustomerNotificationTemplate,
) {
  // Only certain event types have SMS implementations
  const smsParams = {
    store: ctx.store,
    customer: {
      id: ctx.customer.id,
      firstName: ctx.customer.firstName,
      lastName: ctx.customer.lastName,
      phone: ctx.customer.phone,
    },
    reservation: ctx.reservation,
  };

  switch (eventType) {
    case "customer_request_received":
      return sendRequestReceivedSms(smsParams);

    case "customer_request_accepted":
      return sendRequestAcceptedSms(smsParams);

    case "customer_request_rejected":
      return sendRequestRejectedSms(smsParams);

    case "customer_reservation_confirmed":
      return sendReservationConfirmationSms(smsParams);

    case "customer_reservation_cancelled":
      return sendReservationCancelledSms(smsParams);

    case "customer_reminder_pickup":
      return sendReminderPickupSms(smsParams);

    case "customer_reminder_return":
      return sendReminderReturnSms(smsParams);

    case "customer_payment_requested":
      if (!ctx.paymentRequestAmount || !ctx.paymentRequestUrl) {
        throw new Error("Payment request context missing required fields");
      }
      return sendPaymentRequestSms({
        store: ctx.store,
        customer: {
          id: ctx.customer.id,
          firstName: ctx.customer.firstName,
          lastName: ctx.customer.lastName,
          phone: ctx.customer.phone,
        },
        reservation: ctx.reservation,
        amount: ctx.paymentRequestAmount,
        paymentUrl: ctx.paymentRequestUrl,
        currency: ctx.store.settings?.currency,
      });

    case "customer_deposit_authorization_requested":
      if (!ctx.depositAuthorizationAmount || !ctx.depositAuthorizationUrl) {
        throw new Error("Deposit authorization context missing required fields");
      }
      return sendDepositAuthorizationRequestSms({
        store: ctx.store,
        customer: {
          id: ctx.customer.id,
          firstName: ctx.customer.firstName,
          lastName: ctx.customer.lastName,
          phone: ctx.customer.phone,
        },
        reservation: ctx.reservation,
        depositAmount: ctx.depositAuthorizationAmount,
        authorizationUrl: ctx.depositAuthorizationUrl,
        currency: ctx.store.settings?.currency,
      });

    case "customer_quote_sent":
    case "customer_quote_accepted":
      // SMS not implemented for quote events
      return;

    default:
      throw new Error(`Unknown customer notification event type: ${eventType}`);
  }
}

/**
 * Check if customer notifications should be sent for an event
 * Useful for conditional logic in actions
 */
export function shouldSendCustomerNotification(
  eventType: CustomerNotificationEventType,
  settings: CustomerNotificationSettings | null | undefined,
  channel: "email" | "sms",
): boolean {
  // Import defaults
  const defaults: CustomerNotificationSettings = {
    customer_request_received: { enabled: true, email: true, sms: false },
    customer_request_accepted: { enabled: true, email: true, sms: false },
    customer_request_rejected: { enabled: true, email: true, sms: false },
    customer_reservation_confirmed: { enabled: true, email: true, sms: false },
    customer_reservation_cancelled: { enabled: true, email: true, sms: false },
    customer_reminder_pickup: { enabled: true, email: true, sms: false },
    customer_reminder_return: { enabled: true, email: true, sms: false },
    customer_payment_requested: { enabled: true, email: true, sms: false },
    customer_deposit_authorization_requested: { enabled: true, email: true, sms: false },
    customer_quote_sent: { enabled: true, email: true, sms: false },
    customer_quote_accepted: { enabled: true, email: true, sms: false },
    templates: {},
  };

  const effectiveSettings = settings || defaults;
  const prefs = effectiveSettings[eventType];

  return prefs.enabled && prefs[channel];
}
