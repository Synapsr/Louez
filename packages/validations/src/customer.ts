import { z } from "zod";

import { isPossiblePhoneNumberInput } from "./phone";
import { isValidPolishNip } from "./polish-nip";

// Customer type enum
export const customerTypeValues = ["individual", "business"] as const;
export type CustomerType = (typeof customerTypeValues)[number];

export const customerCompanyNumberSchemeValues = ["fr_siren", "be_bce"] as const;

// Base schema without refinement for form validation
const baseCustomerFields = {
  customerType: z.enum(customerTypeValues),
  email: z.union([z.email("validation.email"), z.literal("")]).optional(),
  firstName: z.string().max(255).optional(),
  lastName: z.string().max(255).optional(),
  companyName: z.string().max(255).optional(),
  companyNumber: z.string().max(64).optional(),
  companyNumberScheme: z.enum(customerCompanyNumberSchemeValues).optional(),
  vatNumber: z.string().max(64).optional(),
  phone: z
    .string()
    .refine((val) => !val || isPossiblePhoneNumberInput(val), {
      message: "validation.invalidPhone",
    })
    .optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().length(2, "validation.minLength").optional(),
  notes: z.string().optional(),
  discountPercent: z.coerce.number().int().min(0).max(100).optional(),
};

// Schema factory that accepts translation function
export const createCustomerSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  z
    .object({
      customerType: z.enum(customerTypeValues),
      email: z.union([z.email(t("email")), z.literal("")]).optional(),
      firstName: z.string().max(255).optional(),
      lastName: z.string().max(255).optional(),
      companyName: z.string().max(255).optional(),
      companyNumber: z.string().max(64).optional(),
      companyNumberScheme: z.enum(customerCompanyNumberSchemeValues).optional(),
      vatNumber: z.string().max(64).optional(),
      phone: z
        .string()
        .refine((val) => !val || isPossiblePhoneNumberInput(val), {
          message: t("invalidPhone"),
        })
        .optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      country: z
        .string()
        .length(2, t("minLength", { min: 2 }))
        .optional(),
      notes: z.string().optional(),
      discountPercent: z.coerce.number().int().min(0).max(100).optional(),
    })
    .superRefine((data, ctx) => {
      if (data.customerType === "business") {
        if (!data.companyName || data.companyName.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("companyNameRequired"),
            path: ["companyName"],
          });
        }
        if (!data.vatNumber || data.vatNumber.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("required"),
            path: ["vatNumber"],
          });
        } else if (!isValidPolishNip(data.vatNumber)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("invalidNip"),
            path: ["vatNumber"],
          });
        }
      } else {
        if (!data.firstName || data.firstName.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("required"),
            path: ["firstName"],
          });
        }
        if (!data.lastName || data.lastName.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("required"),
            path: ["lastName"],
          });
        }
      }
    });

// Default schema for server-side validation (uses keys that client will translate)
export const customerSchema = z.object(baseCustomerFields).superRefine((data, ctx) => {
  if (data.customerType === "business") {
    if (!data.companyName || data.companyName.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validation.companyNameRequired",
        path: ["companyName"],
      });
    }
    if (!data.vatNumber || data.vatNumber.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validation.required",
        path: ["vatNumber"],
      });
    } else if (!isValidPolishNip(data.vatNumber)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validation.invalidNip",
        path: ["vatNumber"],
      });
    }
  } else {
    if (!data.firstName || data.firstName.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validation.required",
        path: ["firstName"],
      });
    }
    if (!data.lastName || data.lastName.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "validation.required",
        path: ["lastName"],
      });
    }
  }
});

export type CustomerInput = z.infer<typeof customerSchema>;
