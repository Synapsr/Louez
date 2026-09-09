import { isPlausibleVatNumber, isValidCompanyNumber } from "@louez/validations";
import { z } from "zod";
import { isValidPhoneFormat } from "@/lib/sms/phone";

export const customerProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).max(255),
    lastName: z.string().trim().min(1).max(255),
    phone: z
      .string()
      .trim()
      .max(50)
      .refine((value) => !value || isValidPhoneFormat(value)),
    address: z.string().trim().max(2000),
    city: z.string().trim().max(255),
    postalCode: z.string().trim().max(20),
    isBusinessCustomer: z.boolean(),
    companyName: z.string().trim().max(255),
    companyNumber: z.string().trim().max(64),
    vatNumber: z.string().trim().max(64),
  })
  .refine((value) => !value.isBusinessCustomer || value.companyName.length > 0, {
    path: ["companyName"],
  });

export type CustomerProfileInput = z.infer<typeof customerProfileSchema>;

export const createCustomerProfileSchema = (country: string) =>
  customerProfileSchema.superRefine((value, ctx) => {
    if (!value.isBusinessCustomer) return;
    if (value.companyNumber && !isValidCompanyNumber(country, value.companyNumber))
      ctx.addIssue({ code: "custom", path: ["companyNumber"], message: "invalidCompanyNumber" });
    if (value.vatNumber && !isPlausibleVatNumber(country, value.vatNumber))
      ctx.addIssue({ code: "custom", path: ["vatNumber"], message: "invalidVatNumber" });
  });
