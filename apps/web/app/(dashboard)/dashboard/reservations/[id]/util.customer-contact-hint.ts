import { getCustomerContactChannel, hasCustomerEmail, type CustomerContact } from "@louez/utils";

export type CustomerContactHint = "smsOnly" | "noEmail" | "noContact";

/**
 * The line under a customer without e-mail explaining what the team can
 * still send: SMS versions when SMS is set up, nothing otherwise. A customer
 * with an e-mail needs no explanation.
 */
export const getCustomerContactHint = (
  customer: CustomerContact,
  options: { smsConfigured: boolean },
): CustomerContactHint | null => {
  if (hasCustomerEmail(customer)) return null;
  if (getCustomerContactChannel(customer, { smsAvailable: options.smsConfigured }) === "sms") {
    return "smsOnly";
  }
  return customer.phone?.trim() ? "noEmail" : "noContact";
};
