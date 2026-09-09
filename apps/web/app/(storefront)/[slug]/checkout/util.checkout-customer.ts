import type { CheckoutInitialCustomer } from "./checkout.types";

interface CustomerRowLike {
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  customerType?: "individual" | "business" | null;
  companyName: string | null;
  companyNumber: string | null;
  vatNumber: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
}

/** Form-ready customer from a `customers` row (session or OTP login). */
export const toCheckoutInitialCustomer = (customer: CustomerRowLike): CheckoutInitialCustomer => ({
  email: customer.email,
  firstName: customer.firstName,
  lastName: customer.lastName,
  phone: customer.phone ?? "",
  isBusinessCustomer: customer.customerType === "business",
  companyName: customer.companyName ?? "",
  companyNumber: customer.companyNumber ?? "",
  vatNumber: customer.vatNumber ?? "",
  address: customer.address ?? "",
  city: customer.city ?? "",
  postalCode: customer.postalCode ?? "",
});
