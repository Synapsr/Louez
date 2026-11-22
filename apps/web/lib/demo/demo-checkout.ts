import { DEMO_EMAIL_DOMAIN, DEMO_VISITOR_CUSTOMER } from "./people";

/**
 * The customer a visitor books as on a demo storefront. The checkout opens
 * filled with it, and the server books with its e-mail and phone whatever the
 * form sent: a demo store never holds a visitor's address, so nothing it sends
 * by mistake could reach them.
 */
export const DEMO_VISITOR_EMAIL = `alex.visiteur@${DEMO_EMAIL_DOMAIN}`;

export const demoCheckoutCustomer = {
  email: DEMO_VISITOR_EMAIL,
  firstName: DEMO_VISITOR_CUSTOMER.firstName,
  lastName: DEMO_VISITOR_CUSTOMER.lastName,
  phone: DEMO_VISITOR_CUSTOMER.phone,
  isBusinessCustomer: false,
  companyName: "",
  companyNumber: "",
  vatNumber: "",
  address: "8 rue des Écoles",
  city: "Lyon",
  postalCode: "69003",
} as const;

/** The e-mail and phone a demo checkout books with, over what the form sent. */
export function withDemoVisitorContact<T extends { email: string; phone?: string | null }>(
  customer: T,
): T {
  return { ...customer, email: DEMO_VISITOR_EMAIL, phone: DEMO_VISITOR_CUSTOMER.phone };
}
