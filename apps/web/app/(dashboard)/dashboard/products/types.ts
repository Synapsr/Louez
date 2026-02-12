import type { ComponentType, ReactNode } from 'react'

import type { PricingMode, ProductTaxSettings, TaxSettings } from '@louez/types'
import type { ProductInput } from '@louez/validations'

export interface Category {
  id: string
  name: string
}

export interface PricingTierData {
  id: string
  minDuration: number
  discountPercent: string
  displayOrder: number | null
}

export interface ProductUnitData {
  id: string
  identifier: string
  notes: string | null
  status: 'available' | 'maintenance' | 'retired'
  attributes?: Record<string, string> | null
}

export interface BookingAttributeAxisData {
  key: string
  label: string
  position: number
}

export interface Product {
  id: string
  name: string
  description: string | null
  categoryId: string | null
  price: string
  deposit: string | null
  pricingMode: PricingMode
  pricingTiers?: PricingTierData[]
  quantity: number
  status: 'draft' | 'active' | 'archived' | null
  images: string[] | null
  videoUrl: string | null
  taxSettings?: ProductTaxSettings | null
  enforceStrictTiers?: boolean
  accessoryIds?: string[]
  trackUnits?: boolean
  units?: ProductUnitData[]
  bookingAttributeAxes?: BookingAttributeAxisData[] | null
}

export interface AvailableAccessory {
  id: string
  name: string
  price: string
  images: string[] | null
}

export interface ProductFormProps {
  product?: Product
  categories: Category[]
  currency?: string
  storeTaxSettings?: TaxSettings
  availableAccessories?: AvailableAccessory[]
}

export type ProductFormValues = Omit<ProductInput, 'taxSettings'> & {
  taxSettings: ProductTaxSettings
}

export interface ProductStep {
  id: 'photos' | 'info' | 'pricing' | 'preview'
  title: string
  description: string
}

export type StepDirection = 'forward' | 'backward'

export interface ProductFormComponentApi {
  AppField: ComponentType<{
    name: any
    children: (field: any) => ReactNode
  }>
  Field: ComponentType<{
    name: any
    children: (field: any) => ReactNode
  }>
  setFieldMeta: (name: any, updater: any) => void
  setFieldValue: (name: any, value: any) => void
}
