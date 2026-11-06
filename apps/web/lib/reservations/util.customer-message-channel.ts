import type { CustomerNotificationEventType } from "@louez/types";
import { type CustomerContact, getCustomerContactChannel } from "@louez/utils";

/** The templates the team sends by hand from a reservation (the "send an e-mail" dialog). */
export type ManualMessageTemplate =
  | "contract"
  | "payment_request"
  | "reminder_pickup"
  | "reminder_return"
  | "access_link"
  | "custom";

/** Every message a reservation sends to its customer. */
export type CustomerMessage =
  | CustomerNotificationEventType
  | "contract"
  | "manual_payment_request"
  | "access_link"
  | "custom"
  | "reservation_modified"
  | "review_request"
  | "payment_confirmation";

/**
 * Whether a message also exists as an SMS, i.e. can reach a customer who has
 * no e-mail. The access link and the quote log the customer into the online
 * account, which a customer without e-mail does not have; the contract, the
 * modification notice and the payment confirmation carry documents or details
 * an SMS cannot hold. The manual "payment request" e-mail has no amount: its
 * SMS counterpart is the payment link (`customer_payment_requested`).
 */
const SMS_VERSIONS = {
  customer_request_received: true,
  customer_request_accepted: true,
  customer_request_rejected: true,
  customer_reservation_confirmed: true,
  customer_reminder_pickup: true,
  customer_reminder_return: true,
  customer_payment_requested: true,
  customer_deposit_authorization_requested: true,
  customer_quote_sent: false,
  customer_quote_accepted: false,
  contract: false,
  manual_payment_request: false,
  access_link: false,
  custom: true,
  reservation_modified: false,
  review_request: true,
  payment_confirmation: false,
} as const satisfies Record<CustomerMessage, boolean>;

const MANUAL_TEMPLATE_MESSAGES = {
  contract: "contract",
  payment_request: "manual_payment_request",
  reminder_pickup: "customer_reminder_pickup",
  reminder_return: "customer_reminder_return",
  access_link: "access_link",
  custom: "custom",
} as const satisfies Record<ManualMessageTemplate, CustomerMessage>;

export const hasSmsVersion = (message: CustomerMessage): boolean => SMS_VERSIONS[message];

export const isManualMessageTemplate = (value: string): value is ManualMessageTemplate =>
  value in MANUAL_TEMPLATE_MESSAGES;

export const getManualTemplateMessage = (template: ManualMessageTemplate): CustomerMessage =>
  MANUAL_TEMPLATE_MESSAGES[template];

/**
 * How one message reaches this customer: e-mail when they have one, its SMS
 * version when they only have a phone and SMS is set up, nothing otherwise
 * (the dashboard then hides the action, an automatic send skips it).
 */
export const getCustomerMessageChannel = (
  message: CustomerMessage,
  customer: CustomerContact,
  options: { smsConfigured: boolean },
): "email" | "sms" | null =>
  getCustomerContactChannel(customer, {
    smsAvailable: options.smsConfigured && hasSmsVersion(message),
  });

/**
 * Where an automatic notification goes. The store's settings, narrowed for
 * reminders by the customer's own preferences, pick the channels; the only
 * new rule is that an e-mail the customer cannot receive goes out as its SMS
 * version instead, unless an SMS already goes out or the customer turned SMS
 * reminders off.
 */
export const resolveNotificationDelivery = (params: {
  message: CustomerNotificationEventType;
  /** Channels after the store settings and the customer's preferences. */
  channels: { email: boolean; sms: boolean };
  /** False when the customer opted out of SMS for this message. */
  smsAllowed: boolean;
  smsConfigured: boolean;
  customer: CustomerContact;
}): { email: boolean; sms: boolean; smsFallback: boolean } => {
  const hasEmail = Boolean(params.customer.email?.trim());
  const hasPhone = Boolean(params.customer.phone?.trim());
  const smsFallback =
    params.channels.email &&
    !hasEmail &&
    !params.channels.sms &&
    params.smsAllowed &&
    params.smsConfigured &&
    hasPhone &&
    hasSmsVersion(params.message);

  return {
    email: params.channels.email && hasEmail,
    sms: (params.channels.sms && hasPhone) || smsFallback,
    smsFallback,
  };
};
