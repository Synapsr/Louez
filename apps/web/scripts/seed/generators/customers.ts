/**
 * Customers Generator
 *
 * Generates customers (individual and business) with realistic French data.
 */

import type { StoreConfig } from '../config'
import {
  generateId,
  generateToken,
  generateFrenchPhone,
  pickRandom,
  randomInt,
  chance,
  addDays,
  logProgress,
} from '../utils'
import {
  FRENCH_FIRST_NAMES,
  FRENCH_LAST_NAMES,
  FRENCH_COMPANY_NAMES,
  FRENCH_STREET_NAMES,
  FRENCH_CITIES,
  NEIGHBORING_COUNTRIES,
  CUSTOMER_NOTES_TEMPLATES,
  generateFrenchEmail,
  generateCompanyEmail,
} from '../data/customer-names'

export interface GeneratedCustomer {
  id: string
  storeId: string
  customerType: 'individual' | 'business'
  email: string
  firstName: string
  lastName: string
  companyName: string | null
  phone: string | null
  address: string | null
  city: string | null
  postalCode: string | null
  country: string
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export interface GeneratedCustomerSession {
  id: string
  customerId: string
  token: string
  expiresAt: Date
  createdAt: Date
}

export interface CustomersGeneratorResult {
  customers: GeneratedCustomer[]
  customerSessions: GeneratedCustomerSession[]
  /** Map from customer email to customer ID */
  customerIdMap: Map<string, string>
}

/**
 * Generate a random French address
 */
function generateFrenchAddress(): { address: string; city: string; postalCode: string; country: string } {
  const cityData = pickRandom(FRENCH_CITIES)
  const streetNumber = randomInt(1, 150)
  const streetName = pickRandom(FRENCH_STREET_NAMES)

  return {
    address: `${streetNumber} ${streetName}`,
    city: cityData.name,
    postalCode: pickRandom(cityData.postalCodes),
    country: 'FR',
  }
}

/**
 * Generate a neighboring country address
 */
function generateNeighboringCountryAddress(): { address: string; city: string; postalCode: string; country: string } {
  const country = pickRandom(NEIGHBORING_COUNTRIES)

  // Simplified foreign addresses
  const cities: Record<string, { name: string; postalCode: string }[]> = {
    BE: [
      { name: 'Bruxelles', postalCode: '1000' },
      { name: 'Liège', postalCode: '4000' },
      { name: 'Namur', postalCode: '5000' },
    ],
    CH: [
      { name: 'Genève', postalCode: '1201' },
      { name: 'Lausanne', postalCode: '1003' },
      { name: 'Zurich', postalCode: '8001' },
    ],
    DE: [
      { name: 'Berlin', postalCode: '10115' },
      { name: 'Munich', postalCode: '80331' },
      { name: 'Freiburg', postalCode: '79098' },
    ],
    IT: [
      { name: 'Turin', postalCode: '10121' },
      { name: 'Milan', postalCode: '20121' },
      { name: 'Nice', postalCode: '06000' },
    ],
    ES: [
      { name: 'Barcelone', postalCode: '08001' },
      { name: 'Madrid', postalCode: '28001' },
      { name: 'San Sebastian', postalCode: '20001' },
    ],
  }

  const cityData = pickRandom(cities[country.code] || cities['BE'])

  return {
    address: `${randomInt(1, 100)} Main Street`,
    city: cityData.name,
    postalCode: cityData.postalCode,
    country: country.code,
  }
}

/**
 * Generate all customers data for a store
 */
export function generateCustomers(
  storeId: string,
  storeConfig: StoreConfig,
  now: Date,
  startDate: Date
): CustomersGeneratorResult {
  const customers: GeneratedCustomer[] = []
  const customerSessions: GeneratedCustomerSession[] = []
  const customerIdMap = new Map<string, string>()

  const usedEmails = new Set<string>()

  // Determine customer mix
  const businessRatio = 0.2 // 20% business customers
  const businessCount = Math.floor(storeConfig.customerCount * businessRatio)
  const individualCount = storeConfig.customerCount - businessCount

  // Generate individual customers
  for (let i = 0; i < individualCount; i++) {
    const isMale = chance(0.5)
    const firstName = pickRandom(isMale ? FRENCH_FIRST_NAMES.male : FRENCH_FIRST_NAMES.female)
    const lastName = pickRandom(FRENCH_LAST_NAMES)

    // Generate unique email
    let email = generateFrenchEmail(firstName, lastName)
    let attempts = 0
    while (usedEmails.has(email) && attempts < 10) {
      email = generateFrenchEmail(firstName, lastName)
      attempts++
    }
    if (usedEmails.has(email)) {
      email = `${firstName.toLowerCase()}${randomInt(100, 999)}@gmail.com`
    }
    usedEmails.add(email)

    const customerId = generateId()
    customerIdMap.set(email, customerId)

    // Determine if customer has full address (60% have)
    const hasAddress = chance(0.6)
    let addressData: { address: string | null; city: string | null; postalCode: string | null; country: string } = {
      address: null,
      city: null,
      postalCode: null,
      country: 'FR',
    }

    if (hasAddress) {
      // 90% French, 10% neighboring countries
      if (chance(0.9)) {
        addressData = generateFrenchAddress()
      } else {
        addressData = generateNeighboringCountryAddress()
      }
    }

    // Random creation date within the seed period
    const createdAt = new Date(
      startDate.getTime() +
        Math.random() * (now.getTime() - startDate.getTime())
    )

    customers.push({
      id: customerId,
      storeId,
      customerType: 'individual',
      email,
      firstName,
      lastName,
      companyName: null,
      phone: chance(0.8) ? generateFrenchPhone() : null, // 80% have phone
      address: addressData.address,
      city: addressData.city,
      postalCode: addressData.postalCode,
      country: addressData.country,
      notes: pickRandom(CUSTOMER_NOTES_TEMPLATES),
      createdAt,
      updatedAt: now,
    })

    logProgress(i + 1, individualCount, `Individual customers for ${storeConfig.name}`)
  }

  // Generate business customers
  for (let i = 0; i < businessCount; i++) {
    const companyName = FRENCH_COMPANY_NAMES[i % FRENCH_COMPANY_NAMES.length]

    // Contact person for the business
    const isMale = chance(0.5)
    const firstName = pickRandom(isMale ? FRENCH_FIRST_NAMES.male : FRENCH_FIRST_NAMES.female)
    const lastName = pickRandom(FRENCH_LAST_NAMES)

    // Generate company email
    let email = generateCompanyEmail(companyName)
    let attempts = 0
    while (usedEmails.has(email) && attempts < 10) {
      email = `contact${randomInt(1, 99)}@${companyName.toLowerCase().replace(/\s+/g, '')}.fr`
      attempts++
    }
    usedEmails.add(email)

    const customerId = generateId()
    customerIdMap.set(email, customerId)

    // Business customers always have address
    const addressData = generateFrenchAddress()

    const createdAt = new Date(
      startDate.getTime() +
        Math.random() * (now.getTime() - startDate.getTime())
    )

    customers.push({
      id: customerId,
      storeId,
      customerType: 'business',
      email,
      firstName,
      lastName,
      companyName,
      phone: generateFrenchPhone(),
      address: addressData.address,
      city: addressData.city,
      postalCode: addressData.postalCode,
      country: addressData.country,
      notes: `Client professionnel - ${companyName}`,
      createdAt,
      updatedAt: now,
    })

    logProgress(i + 1, businessCount, `Business customers for ${storeConfig.name}`)
  }

  // Generate active customer sessions (10-20% of customers)
  const activeSessionCount = Math.floor(customers.length * 0.15)
  const customersWithSessions = pickRandom(
    customers.filter((c) => c.customerType === 'individual')
  )

  for (let i = 0; i < Math.min(activeSessionCount, customers.length); i++) {
    const customer = customers[i]

    customerSessions.push({
      id: generateId(),
      customerId: customer.id,
      token: generateToken(255),
      expiresAt: addDays(now, randomInt(1, 30)), // Session expires in 1-30 days
      createdAt: new Date(now.getTime() - randomInt(0, 7) * 24 * 60 * 60 * 1000),
    })
  }

  return {
    customers,
    customerSessions,
    customerIdMap,
  }
}
