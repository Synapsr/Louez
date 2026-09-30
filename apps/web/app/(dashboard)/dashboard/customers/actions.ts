'use server'

import {
  getCustomerFieldValues,
  listCustomerFieldDefinitions,
  saveCustomerFieldValues,
} from '@louez/api/services/customer-fields'
import {
  customerCommunicationPreferences,
  customerFieldValues,
  customerSessions,
  customers,
  db,
  reservations,
} from '@louez/db'
import type { CustomerFieldValues, ResolvedCustomerProfileSettings } from '@louez/types'
import { normalizeCustomerSocialLinks } from '@louez/utils'
import {
  customerSchema,
  customerSectionSchema,
  digitsOnly,
  isValidCompanyNumber,
  resolveCompanyNumberScheme,
  resolveCustomerProfileSettings,
  validateCustomerFieldValues,
  type CustomerInput,
  type CustomerSectionInput,
} from '@louez/validations'
import { and, count, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'

import { notifyCustomerCreated } from '@/lib/discord/platform-notifications'
import { log } from '@/lib/evlog'
import { getCurrentStore } from '@/lib/store-context'

async function getStoreId() {
  const store = await getCurrentStore()

  if (!store) {
    throw new Error('errors.storeNotFound')
  }

  return store.id
}

/**
 * Company identifiers as they must be persisted.
 *
 * The scheme is always derived from the customer's country — never read from
 * the submitted payload — so it can't contradict the number it labels, and
 * both identifiers are dropped when the customer is not a business. A number
 * that doesn't match its country's format is kept as typed but gets no scheme:
 * the invoice then degrades to B2C instead of being transmitted with a bogus
 * identifier.
 */
function resolveCustomerCompanyFields(
  validated: Pick<CustomerInput, 'customerType' | 'country' | 'companyNumber' | 'vatNumber'>,
) {
  if (validated.customerType !== 'business') {
    return { companyNumber: null, companyNumberScheme: null, vatNumber: null }
  }

  const country = validated.country ?? ''
  const raw = validated.companyNumber?.trim() ?? ''
  const isUsable = raw.length > 0 && isValidCompanyNumber(country, raw)
  const scheme = isUsable ? resolveCompanyNumberScheme(country) : null
  // FR/BE identifiers are pure digits; elsewhere keep what was typed.
  const companyNumber = scheme ? digitsOnly(raw) : raw
  const vatNumber = validated.vatNumber?.replace(/\s/g, '').toUpperCase() ?? ''

  return {
    companyNumber: companyNumber.length > 0 ? companyNumber : null,
    companyNumberScheme: scheme,
    vatNumber: vatNumber.length > 0 ? vatNumber : null,
  }
}

/** Profile columns as persisted: blanks become NULL, links are reduced to their stored form. */
function resolveCustomerProfileFields(
  input: Pick<
    CustomerSectionInput,
    'birthDate' | 'acquisitionSource' | 'acquisitionSourceDetail' | 'socialLinks'
  >,
) {
  const source = input.acquisitionSource ?? null
  return {
    ...(input.birthDate !== undefined ? { birthDate: input.birthDate || null } : {}),
    ...(input.acquisitionSource !== undefined ? { acquisitionSource: source } : {}),
    ...(input.acquisitionSourceDetail !== undefined || input.acquisitionSource !== undefined
      ? { acquisitionSourceDetail: source ? input.acquisitionSourceDetail?.trim() || null : null }
      : {}),
    ...(input.socialLinks !== undefined
      ? { socialLinks: normalizeCustomerSocialLinks(input.socialLinks) }
      : {}),
  }
}

/** The store may require a birth date or an origin: the form says so, the server makes sure. */
function hasMissingRequiredProfileField(
  settings: ResolvedCustomerProfileSettings,
  validated: Pick<CustomerInput, 'birthDate' | 'acquisitionSource'>,
) {
  return (
    (settings.birthDate.visibility === 'required' && !validated.birthDate) ||
    (settings.acquisitionSource.visibility === 'required' && !validated.acquisitionSource)
  )
}

/** Submitted custom values checked against the store's own definitions. */
async function checkCustomFields(params: {
  storeId: string
  customerType: 'individual' | 'business'
  values: CustomerFieldValues | undefined
  partial: boolean
}) {
  const definitions = await listCustomerFieldDefinitions(params.storeId, { activeOnly: true, scope: 'customer' })
  const { values, issues } = validateCustomerFieldValues({
    definitions,
    values: params.values,
    customerType: params.customerType,
    partial: params.partial,
  })
  return { definitions, values, issues }
}

export async function createCustomer(data: CustomerInput) {
  try {
    const store = await getCurrentStore()
    if (!store) return { error: 'errors.storeNotFound' }

    const { customFields, ...validated } = customerSchema.parse(data)

    const profileSettings = resolveCustomerProfileSettings(store.settings?.customerProfile)
    if (hasMissingRequiredProfileField(profileSettings, validated)) {
      return { error: 'errors.customFieldsInvalid' }
    }

    // Check if customer with same email already exists
    const existingCustomer = await db.query.customers.findFirst({
      columns: { id: true },
      where: and(eq(customers.storeId, store.id), eq(customers.email, validated.email)),
    })

    if (existingCustomer) {
      return { error: 'errors.emailAlreadyExists' }
    }

    const fields = await checkCustomFields({
      storeId: store.id,
      customerType: validated.customerType,
      values: customFields,
      partial: false,
    })
    if (fields.issues.length > 0) {
      return { error: 'errors.customFieldsInvalid', fieldIssues: fields.issues }
    }

    const customerId = await db.transaction(async (tx) => {
      const [customer] = await tx
        .insert(customers)
        .values({
          storeId: store.id,
          ...validated,
          ...resolveCustomerCompanyFields(validated),
          ...resolveCustomerProfileFields(validated),
          createdVia: 'dashboard',
        })
        .$returningId()

      await saveCustomerFieldValues(tx, {
        storeId: store.id,
        customerId: customer.id,
        values: fields.values,
        definitions: fields.definitions,
      })
      return customer.id
    })

    notifyCustomerCreated(
      { id: store.id, name: store.name, slug: store.slug },
      { firstName: validated.firstName, lastName: validated.lastName, email: validated.email },
    ).catch(() => {})

    revalidatePath('/dashboard/customers')
    return { success: true, customerId }
  } catch (error) {
    log.error('customers', `create failed: ${error instanceof Error ? error.message : String(error)}`)
    return { error: 'errors.createCustomerError' }
  }
}

export async function updateCustomer(customerId: string, data: CustomerInput) {
  try {
    const store = await getCurrentStore()
    if (!store) return { error: 'errors.storeNotFound' }
    const storeId = store.id
    const { customFields, ...validated } = customerSchema.parse(data)

    const profileSettings = resolveCustomerProfileSettings(store.settings?.customerProfile)
    if (hasMissingRequiredProfileField(profileSettings, validated)) {
      return { error: 'errors.customFieldsInvalid' }
    }

    // Check if customer exists and belongs to store
    const existingCustomer = await db.query.customers.findFirst({
      columns: { id: true, email: true },
      where: and(eq(customers.id, customerId), eq(customers.storeId, storeId)),
    })

    if (!existingCustomer) {
      return { error: 'errors.customerNotFound' }
    }

    // Check if another customer with same email exists
    if (validated.email !== existingCustomer.email) {
      const emailExists = await db.query.customers.findFirst({
        columns: { id: true },
        where: and(eq(customers.storeId, storeId), eq(customers.email, validated.email)),
      })

      if (emailExists) {
        return { error: 'errors.emailAlreadyExists' }
      }
    }

    const fields = await checkCustomFields({
      storeId,
      customerType: validated.customerType,
      values: customFields,
      partial: false,
    })
    if (fields.issues.length > 0) {
      return { error: 'errors.customFieldsInvalid', fieldIssues: fields.issues }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(customers)
        .set({
          ...validated,
          ...resolveCustomerCompanyFields(validated),
          ...resolveCustomerProfileFields({
            birthDate: validated.birthDate ?? '',
            acquisitionSource: validated.acquisitionSource ?? null,
            acquisitionSourceDetail: validated.acquisitionSourceDetail ?? '',
            socialLinks: validated.socialLinks ?? {},
          }),
          updatedAt: new Date(),
        })
        .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)))

      await saveCustomerFieldValues(tx, {
        storeId,
        customerId,
        values: fields.values,
        definitions: fields.definitions,
      })
    })

    revalidatePath('/dashboard/customers')
    revalidatePath(`/dashboard/customers/${customerId}`)
    return { success: true }
  } catch (error) {
    log.error('customers', `update failed: ${error instanceof Error ? error.message : String(error)}`)
    return { error: 'errors.updateCustomerError' }
  }
}

/**
 * Saves the fields of the customer record edited in place (its "Informations"
 * Sheet), leaving the rest untouched.
 */
export async function updateCustomerSection(customerId: string, data: CustomerSectionInput) {
  try {
    const storeId = await getStoreId()
    const { customFields, email, companyNumber, vatNumber, ...section } =
      customerSectionSchema.parse(data)

    const existingCustomer = await db.query.customers.findFirst({
      columns: {
        id: true,
        email: true,
        customerType: true,
        country: true,
        companyNumber: true,
        vatNumber: true,
      },
      where: and(eq(customers.id, customerId), eq(customers.storeId, storeId)),
    })
    if (!existingCustomer) {
      return { error: 'errors.customerNotFound' }
    }

    // The scheme follows the number and the country: both are settled together, as on the full form.
    const company =
      companyNumber !== undefined || vatNumber !== undefined
        ? resolveCustomerCompanyFields({
            customerType: existingCustomer.customerType,
            country: section.country ?? existingCustomer.country ?? undefined,
            companyNumber: companyNumber ?? existingCustomer.companyNumber ?? undefined,
            vatNumber: vatNumber ?? existingCustomer.vatNumber ?? undefined,
          })
        : {}

    if (email !== undefined && email !== existingCustomer.email) {
      const emailExists = await db.query.customers.findFirst({
        columns: { id: true },
        where: and(eq(customers.storeId, storeId), eq(customers.email, email)),
      })
      if (emailExists) {
        return { error: 'errors.emailAlreadyExists' }
      }
    }

    const fields = await checkCustomFields({
      storeId,
      customerType: existingCustomer.customerType,
      values: customFields,
      partial: true,
    })
    if (fields.issues.length > 0) {
      return { error: 'errors.customFieldsInvalid', fieldIssues: fields.issues }
    }

    const { birthDate, acquisitionSource, acquisitionSourceDetail, socialLinks, ...contact } =
      section

    await db.transaction(async (tx) => {
      await tx
        .update(customers)
        .set({
          ...contact,
          ...company,
          ...(email !== undefined ? { email } : {}),
          ...resolveCustomerProfileFields({
            birthDate,
            acquisitionSource,
            acquisitionSourceDetail,
            socialLinks,
          }),
          updatedAt: new Date(),
        })
        .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)))

      if (customFields !== undefined) {
        await saveCustomerFieldValues(tx, {
          storeId,
          customerId,
          values: fields.values,
          definitions: fields.definitions,
        })
      }
    })

    revalidatePath('/dashboard/customers')
    revalidatePath(`/dashboard/customers/${customerId}`)
    return { success: true, customFields: await getCustomerFieldValues(storeId, customerId) }
  } catch (error) {
    log.error(
      'customers',
      `record update failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { error: 'errors.updateCustomerError' }
  }
}

export async function deleteCustomer(customerId: string) {
  try {
    const storeId = await getStoreId()

    // Check if customer exists and belongs to store
    const existingCustomer = await db.query.customers.findFirst({
      columns: { id: true },
      where: and(eq(customers.id, customerId), eq(customers.storeId, storeId)),
    })

    if (!existingCustomer) {
      return { error: 'errors.customerNotFound' }
    }

    // Check if customer has reservations
    const reservationCount = await db
      .select({ count: count() })
      .from(reservations)
      .where(eq(reservations.customerId, customerId))

    if (reservationCount[0]?.count > 0) {
      return { error: 'errors.customerHasReservations' }
    }

    // Nothing references these rows once the customer is gone, and they hold personal data.
    await db.transaction(async (tx) => {
      await tx
        .delete(customerFieldValues)
        .where(
          and(
            eq(customerFieldValues.storeId, storeId),
            eq(customerFieldValues.customerId, customerId),
          ),
        )
      await tx.delete(customerSessions).where(eq(customerSessions.customerId, customerId))
      await tx
        .delete(customerCommunicationPreferences)
        .where(
          and(
            eq(customerCommunicationPreferences.customerId, customerId),
            eq(customerCommunicationPreferences.storeId, storeId),
          ),
        )
      await tx
        .delete(customers)
        .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)))
    })

    revalidatePath('/dashboard/customers')
    return { success: true }
  } catch (error) {
    log.error('customers', `delete failed: ${error instanceof Error ? error.message : String(error)}`)
    return { error: 'errors.deleteCustomerError' }
  }
}

export async function updateCustomerNotes(customerId: string, notes: string) {
  try {
    const storeId = await getStoreId()

    // Check if customer exists and belongs to store
    const existingCustomer = await db.query.customers.findFirst({
      columns: { id: true },
      where: and(eq(customers.id, customerId), eq(customers.storeId, storeId)),
    })

    if (!existingCustomer) {
      return { error: 'errors.customerNotFound' }
    }

    await db
      .update(customers)
      .set({
        notes,
        updatedAt: new Date(),
      })
      .where(and(eq(customers.id, customerId), eq(customers.storeId, storeId)))

    revalidatePath(`/dashboard/customers/${customerId}`)
    return { success: true }
  } catch (error) {
    log.error(
      'customers',
      `notes update failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return { error: 'errors.updateNotesError' }
  }
}
