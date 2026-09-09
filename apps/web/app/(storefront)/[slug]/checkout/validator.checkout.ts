import { formOptions, revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";

import { isPlausibleVatNumber, isValidCompanyNumber } from "@louez/validations";

import { isValidPhoneFormat } from "@/lib/sms/phone";

import type { CheckoutFormValues, CheckoutInitialCustomer } from "./checkout.types";

type CheckoutTranslator = (key: string, values?: Record<string, string | number>) => string;

interface CheckoutValidatorOptions {
  requireAddress: boolean;
  /** ISO-2 country the buyer's company identifiers are checked against. */
  country: string;
}

export const CHECKOUT_DEFAULT_VALUES: CheckoutFormValues = {
  email: "",
  firstName: "",
  lastName: "",
  phone: "",
  isBusinessCustomer: false,
  companyName: "",
  companyNumber: "",
  vatNumber: "",
  address: "",
  city: "",
  postalCode: "",
  notes: "",
  // Optional Tulip cover is opt-in: no pre-ticked paid extra (Teo, 2026-09-07;
  // EU Consumer Rights Directive art. 22). Required mode is forced server-side.
  tulipInsuranceOptIn: false,
  acceptCgv: false,
};

export const getCheckoutDefaultValues = (
  customer: CheckoutInitialCustomer | null,
): CheckoutFormValues =>
  customer ? { ...CHECKOUT_DEFAULT_VALUES, ...customer } : CHECKOUT_DEFAULT_VALUES;

/**
 * Checkout schema. The return type is widened on purpose: the form and the
 * `withForm` steps must carry the same validator type, and the real schema
 * is only built once the translator and the store options are known.
 */
export const createCheckoutValidator = (
  t: CheckoutTranslator,
  options: CheckoutValidatorOptions,
): z.ZodType<CheckoutFormValues, CheckoutFormValues> =>
  z
    .object({
      email: z.email(t("errors.invalidEmail")),
      firstName: z.string().min(1, t("errors.firstNameRequired")),
      lastName: z.string().min(1, t("errors.lastNameRequired")),
      phone: z
        .string()
        .min(1, t("errors.phoneRequired"))
        .refine((value) => isValidPhoneFormat(value), t("errors.invalidPhone")),
      isBusinessCustomer: z.boolean(),
      companyName: z.string(),
      companyNumber: z.string().max(64),
      vatNumber: z.string().max(64),
      address: z.string().trim(),
      city: z.string().trim(),
      postalCode: z.string().trim(),
      notes: z.string(),
      tulipInsuranceOptIn: z.boolean(),
      acceptCgv: z.boolean(),
    })
    .superRefine((data, ctx) => {
      if (data.isBusinessCustomer) {
        if (data.companyName.trim().length === 0) {
          ctx.addIssue({
            code: "custom",
            message: t("errors.companyNameRequired"),
            path: ["companyName"],
          });
        }

        // SIREN / VAT stay optional (the invoice degrades to B2C when absent),
        // but a value that IS typed must be usable on an invoice.
        const companyNumber = data.companyNumber.trim();
        if (companyNumber.length > 0 && !isValidCompanyNumber(options.country, companyNumber)) {
          ctx.addIssue({
            code: "custom",
            message: t("errors.invalidCompanyNumber"),
            path: ["companyNumber"],
          });
        }

        const vatNumber = data.vatNumber.trim();
        if (vatNumber.length > 0 && !isPlausibleVatNumber(options.country, vatNumber)) {
          ctx.addIssue({
            code: "custom",
            message: t("errors.invalidVatNumber"),
            path: ["vatNumber"],
          });
        }
      }

      if (!data.acceptCgv) {
        ctx.addIssue({ code: "custom", message: t("errors.acceptCgv"), path: ["acceptCgv"] });
      }

      if (options.requireAddress) {
        for (const field of ["address", "city", "postalCode"] as const) {
          if (data[field].trim().length === 0) {
            ctx.addIssue({ code: "custom", message: t("errors.required"), path: [field] });
          }
        }
      }
    });

const passthroughTranslator: CheckoutTranslator = (key) => key;

/**
 * Shared form options: the form (`useAppForm`) and every step (`withForm`)
 * spread these so their `form` types line up. The form replaces the
 * validator with the translated one for the store.
 */
export const checkoutFormOptions = formOptions({
  defaultValues: CHECKOUT_DEFAULT_VALUES,
  validationLogic: revalidateLogic({ mode: "submit", modeAfterSubmission: "change" }),
  validators: {
    onSubmit: createCheckoutValidator(passthroughTranslator, {
      requireAddress: true,
      country: "FR",
    }),
  },
});

/**
 * Type-only placeholder for `withForm({ props })`: TanStack reads the value
 * for inference alone, the real props always come from the parent.
 */
export const checkoutStepProps = <TProps extends object>(): TProps => Object.create(null);
