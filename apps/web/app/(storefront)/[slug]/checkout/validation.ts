import { z } from 'zod';

import { isPlausibleVatNumber, isValidCompanyNumber } from '@louez/validations';

import { isValidPhoneFormat } from '@/lib/sms/phone';

type CheckoutTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function createCheckoutSchema(t: CheckoutTranslator) {
  return createCheckoutSchemaWithOptions(t, {
    requireAddress: true,
    country: 'FR',
  });
}

export function createCheckoutSchemaWithOptions(
  t: CheckoutTranslator,
  options: {
    requireAddress: boolean;
    /** ISO-2 country the buyer's company identifiers are checked against. */
    country: string;
  },
) {
  return z
    .object({
      email: z.email(t('errors.invalidEmail')),
      firstName: z.string().min(1, t('errors.firstNameRequired')),
      lastName: z.string().min(1, t('errors.lastNameRequired')),
      phone: z
        .string()
        .min(1, t('errors.phoneRequired'))
        .refine((value) => isValidPhoneFormat(value), t('errors.invalidPhone')),
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
      if (data.isBusinessCustomer && data.companyName.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('errors.companyNameRequired'),
          path: ['companyName'],
        });
      }

      // SIREN / VAT number stay optional (the invoice degrades to B2C when
      // absent), but a value that IS typed must be usable on an invoice.
      if (data.isBusinessCustomer) {
        const companyNumber = data.companyNumber.trim();

        if (
          companyNumber.length > 0 &&
          !isValidCompanyNumber(options.country, companyNumber)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('errors.invalidCompanyNumber'),
            path: ['companyNumber'],
          });
        }

        const vatNumber = data.vatNumber.trim();
        if (
          vatNumber.length > 0 &&
          !isPlausibleVatNumber(options.country, vatNumber)
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('errors.invalidVatNumber'),
            path: ['vatNumber'],
          });
        }
      }

      if (!data.acceptCgv) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: t('errors.acceptCgv'),
          path: ['acceptCgv'],
        });
      }

      if (options.requireAddress) {
        if (data.address.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('errors.required'),
            path: ['address'],
          });
        }

        if (data.city.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('errors.required'),
            path: ['city'],
          });
        }

        if (data.postalCode.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t('errors.required'),
            path: ['postalCode'],
          });
        }
      }
    });
}
