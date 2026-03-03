import { z } from 'zod';

type CheckoutTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export function createCheckoutSchema(t: CheckoutTranslator) {
  return createCheckoutSchemaWithOptions(t, {
    requireAddress: true,
  });
}

export function createCheckoutSchemaWithOptions(
  t: CheckoutTranslator,
  options: {
    requireAddress: boolean;
  },
) {
  return z
    .object({
      email: z.string().email(t('errors.invalidEmail')),
      firstName: z.string().min(1, t('errors.firstNameRequired')),
      lastName: z.string().min(1, t('errors.lastNameRequired')),
      phone: z
        .string()
        .min(1, t('errors.phoneRequired'))
        .regex(/^\+[1-9]\d{6,14}$/, t('errors.invalidPhone')),
      isBusinessCustomer: z.boolean(),
      companyName: z.string(),
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
