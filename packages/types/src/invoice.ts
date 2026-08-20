export type InvoiceCompanyNumberScheme = 'fr_siren' | 'be_bce'

export interface InvoiceAddressSnapshot {
  address: string
  addressComplement: string | null
  postalCode: string
  city: string
  country: string
}

export interface InvoiceSellerSnapshot {
  legalName: string
  legalForm: string
  companyNumber: string
  companyNumberScheme: InvoiceCompanyNumberScheme | null
  siret: string | null
  vatNumber: string | null
  rcsCity: string | null
  shareCapital: string | null
  address: InvoiceAddressSnapshot
  email: string | null
  phone: string | null
}

export interface InvoiceBuyerSnapshot {
  customerType: 'individual' | 'business'
  firstName: string
  lastName: string
  companyName: string | null
  companyNumber: string | null
  companyNumberScheme: InvoiceCompanyNumberScheme | null
  vatNumber: string | null
  address: InvoiceAddressSnapshot | null
  email: string
  phone: string | null
}

export interface InvoiceLineSnapshot {
  id: string
  description: string
  quantity: string
  unitPriceExclTax: string
  totalExclTax: string
  taxRate: string
  taxAmount: string
  totalInclTax: string
}

export interface InvoiceVatBreakdownSnapshot {
  taxRate: string
  taxableAmount: string
  taxAmount: string
  exemptionReason: string | null
}

export type En16931InvoiceSnapshot = Record<string, unknown>
