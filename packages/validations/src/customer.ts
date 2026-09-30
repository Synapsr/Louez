import { CUSTOMER_ACQUISITION_SOURCES, CUSTOMER_SOCIAL_NETWORKS } from '@louez/types';
import { z } from 'zod';

import { customerFieldValuesSchema } from './customer-fields';
import { isPossiblePhoneNumberInput } from './phone';

// Customer type enum
export const customerTypeValues = ['individual', 'business'] as const;
export type CustomerType = (typeof customerTypeValues)[number];

export const customerCompanyNumberSchemeValues = [
  'fr_siren',
  'be_bce',
] as const;

const OLDEST_BIRTH_YEAR = 1900;

/** An ISO `yyyy-MM-dd` day that exists, is not in the future and is a plausible birth year. */
export const isPlausibleBirthDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return date.getUTCFullYear() >= OLDEST_BIRTH_YEAR && date.getTime() <= Date.now();
};

interface CustomerSchemaMessages {
  email: string;
  required: string;
  invalidPhone: string;
  countryLength: string;
  companyNameRequired: string;
  invalidDate: string;
}

// One shape for the client (translated messages) and the server (message keys):
// a field added here reaches both.
const buildCustomerSchema = (messages: CustomerSchemaMessages) =>
  z
    .object({
      customerType: z.enum(customerTypeValues),
      email: z.email(messages.email),
      firstName: z.string().min(1, messages.required).max(255),
      lastName: z.string().min(1, messages.required).max(255),
      companyName: z.string().max(255).optional(),
      companyNumber: z.string().max(64).optional(),
      companyNumberScheme: z.enum(customerCompanyNumberSchemeValues).optional(),
      vatNumber: z.string().max(64).optional(),
      phone: z
        .string()
        .refine((val) => !val || isPossiblePhoneNumberInput(val), {
          message: messages.invalidPhone,
        })
        .optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      postalCode: z.string().optional(),
      country: z.string().length(2, messages.countryLength).optional(),
      birthDate: z
        .string()
        .refine((val) => !val || isPlausibleBirthDate(val), { message: messages.invalidDate })
        .optional(),
      acquisitionSource: z.enum(CUSTOMER_ACQUISITION_SOURCES).optional(),
      acquisitionSourceDetail: z.string().max(255).optional(),
      socialLinks: z.partialRecord(z.enum(CUSTOMER_SOCIAL_NETWORKS), z.string().max(255)).optional(),
      notes: z.string().optional(),
      /** Custom field values keyed by definition id, checked against the store's definitions server-side. */
      customFields: customerFieldValuesSchema.optional(),
    })
    .superRefine((data, ctx) => {
      // If business customer, company name is required
      if (
        data.customerType === 'business' &&
        (!data.companyName || data.companyName.trim().length === 0)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: messages.companyNameRequired,
          path: ['companyName'],
        });
      }
    });

// Schema factory that accepts translation function
export const createCustomerSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string,
) =>
  buildCustomerSchema({
    email: t('email'),
    required: t('required'),
    invalidPhone: t('invalidPhone'),
    countryLength: t('minLength', { min: 2 }),
    companyNameRequired: t('companyNameRequired'),
    invalidDate: t('date'),
  });

// Default schema for server-side validation (uses keys that client will translate)
export const customerSchema = buildCustomerSchema({
  email: 'validation.email',
  required: 'validation.required',
  invalidPhone: 'validation.invalidPhone',
  countryLength: 'validation.minLength',
  companyNameRequired: 'validation.companyNameRequired',
  invalidDate: 'validation.date',
});

export type CustomerInput = z.infer<typeof customerSchema>;

/**
 * The customer record edited in place (its "Informations" Sheet): only the
 * fields it carries are written, the rest of the record is left alone.
 */
export const customerSectionSchema = z.object({
  email: z.email('validation.email').optional(),
  /** A business customer's identifiers; ignored for an individual. */
  companyNumber: z.string().max(64).optional(),
  vatNumber: z.string().max(64).optional(),
  phone: z
    .string()
    .refine((val) => !val || isPossiblePhoneNumberInput(val), {
      message: 'validation.invalidPhone',
    })
    .optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().length(2, 'validation.minLength').optional(),
  birthDate: z
    .string()
    .refine((val) => !val || isPlausibleBirthDate(val), { message: 'validation.date' })
    .optional(),
  acquisitionSource: z.enum(CUSTOMER_ACQUISITION_SOURCES).nullable().optional(),
  acquisitionSourceDetail: z.string().max(255).optional(),
  socialLinks: z.partialRecord(z.enum(CUSTOMER_SOCIAL_NETWORKS), z.string().max(255)).optional(),
  customFields: customerFieldValuesSchema.optional(),
});

export type CustomerSectionInput = z.infer<typeof customerSectionSchema>;
