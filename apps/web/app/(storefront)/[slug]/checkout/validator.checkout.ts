import { formOptions, revalidateLogic } from "@tanstack/react-form";
import { z } from "zod";

import { CUSTOMER_SOCIAL_NETWORKS } from "@louez/types";
import {
  isPlausibleVatNumber,
  isValidCompanyNumber,
  type CustomerFieldIssueCode,
} from "@louez/validations";

import type { CustomerProfileFormValues } from "@/components/storefront/customer-fields/customer-fields.types";
import { EMPTY_CUSTOMER_PROFILE_FORM_VALUES } from "@/components/storefront/customer-fields/util.customer-profile-fields";
import { isValidPhoneFormat } from "@/lib/sms/phone";

import type {
  CheckoutFieldsPlans,
  CheckoutFormValues,
  CheckoutInitialCustomer,
} from "./checkout.types";
import { getCheckoutFieldIssues } from "./util.checkout-custom-fields";

type CheckoutTranslator = (key: string, values?: Record<string, string | number>) => string;

interface CheckoutValidatorOptions {
  requireAddress: boolean;
  /** ISO-2 country the buyer's company identifiers are checked against. */
  country: string;
  /** Custom fields this cart asks, per buyer type; absent when nothing is known yet. */
  checkoutFields?: CheckoutFieldsPlans;
  /** Wording of a custom field value the shared rules refuse. */
  customFieldIssueMessage?: (code: CustomerFieldIssueCode) => string;
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
  profileFields: EMPTY_CUSTOMER_PROFILE_FORM_VALUES,
  customerFields: {},
  itemDetails: {},
};

/**
 * The form a checkout opens with. Custom and native field values only come
 * with a signed-in customer: they prefill what the store asks again.
 */
export const getCheckoutDefaultValues = (
  customer: CheckoutInitialCustomer | null,
  customerFields: Record<string, string> = {},
  profileFields: CustomerProfileFormValues = EMPTY_CUSTOMER_PROFILE_FORM_VALUES,
): CheckoutFormValues =>
  customer
    ? { ...CHECKOUT_DEFAULT_VALUES, ...customer, profileFields, customerFields }
    : CHECKOUT_DEFAULT_VALUES;

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
      profileFields: z.object({
        birthDate: z.string(),
        acquisitionSource: z.object({ source: z.string(), detail: z.string() }),
        socialLinks: z.partialRecord(z.enum(CUSTOMER_SOCIAL_NETWORKS), z.string()),
      }),
      customerFields: z.record(z.string(), z.string()),
      // Lenient on purpose: a unit only holds the keys the customer touched.
      itemDetails: z.record(
        z.string(),
        z.object({
          participantName: z.string().optional(),
          values: z.record(z.string(), z.string()).optional(),
        }),
      ),
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

      if (options.checkoutFields) {
        const plan = data.isBusinessCustomer
          ? options.checkoutFields.business
          : options.checkoutFields.individual;
        for (const issue of getCheckoutFieldIssues(data, plan)) {
          ctx.addIssue({
            code: "custom",
            message: options.customFieldIssueMessage?.(issue.code) ?? t("errors.required"),
            path: issue.path,
          });
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
