export interface CustomerContact {
  email: string | null;
  phone: string | null;
}

/** A customer that can be written to by e-mail. */
export const hasCustomerEmail = <T extends { email: string | null }>(
  customer: T,
): customer is T & { email: string } => Boolean(customer.email?.trim());

/**
 * How a message reaches a customer: by e-mail when there is one, by SMS
 * otherwise when the message has an SMS version and the customer a phone,
 * nothing at all otherwise. The caller then hides the action or skips the send.
 */
export const getCustomerContactChannel = (
  customer: CustomerContact,
  options: { smsAvailable: boolean },
): "email" | "sms" | null => {
  if (customer.email?.trim()) return "email";
  if (options.smsAvailable && customer.phone?.trim()) return "sms";
  return null;
};

/** A customer entered by the team needs one way to be reached: an e-mail or a phone. */
export const hasCustomerContact = (customer: Partial<CustomerContact>): boolean =>
  Boolean(customer.email?.trim() || customer.phone?.trim());
