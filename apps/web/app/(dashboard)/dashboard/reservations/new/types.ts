import type { ComponentType, ReactNode } from 'react'

import type { BusinessHours, PricingMode } from '@louez/types'

export interface Customer {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string | null
}

export interface ProductPricingTier {
  id: string
  minDuration: number
  discountPercent: string
  displayOrder: number | null
}

export interface Product {
  id: string
  name: string
  price: string
  deposit: string | null
  quantity: number
  pricingMode: PricingMode | null
  images: string[] | null
  pricingTiers: ProductPricingTier[]
}

export interface SelectedProduct {
  productId: string
  quantity: number
  priceOverride?: {
    unitPrice: number
  }
}

export interface CustomItem {
  id: string
  name: string
  description: string
  unitPrice: number
  deposit: number
  quantity: number
  pricingMode: PricingMode
}

export interface PeriodWarning {
  type: 'advance_notice' | 'day_closed' | 'outside_hours' | 'closure_period'
  field: 'start' | 'end' | 'both'
  message: string
  details?: string
}

export interface AvailabilityWarning {
  productId: string
  productName: string
  requestedQuantity: number
  availableQuantity: number
  conflictingReservations?: number
}

export interface NewReservationFormProps {
  customers: Customer[]
  products: Product[]
  businessHours?: BusinessHours
  advanceNoticeMinutes?: number
  existingReservations?: Array<{
    id: string
    startDate: Date
    endDate: Date
    status: string
    items: Array<{ productId: string | null; quantity: number }>
  }>
}

export type StepFieldName =
  | 'customerId'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'startDate'
  | 'endDate'

export interface NewReservationFormValues {
  customerType: 'existing' | 'new'
  customerId: string
  email: string
  firstName: string
  lastName: string
  phone: string
  startDate: Date | undefined
  endDate: Date | undefined
  internalNotes: string
}

export interface ReservationStep {
  id: 'customer' | 'period' | 'products' | 'confirm'
  title: string
  description: string
}

export type StepDirection = 'forward' | 'backward'

export interface NewReservationFormComponentApi {
  AppField: ComponentType<{
    name: keyof NewReservationFormValues
    children: (field: any) => ReactNode
  }>
  Field: ComponentType<{
    name: keyof NewReservationFormValues
    children: (field: any) => ReactNode
  }>
}

export interface ProductPricingDetails {
  productPricingMode: PricingMode
  productDuration: number
  basePrice: number
  calculatedPrice: number
  effectivePrice: number
  hasPriceOverride: boolean
  hasDiscount: boolean
  applicableTierDiscountPercent: number | null
  hasTieredPricing: boolean
}
