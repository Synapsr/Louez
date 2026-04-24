import type { ComponentType, ReactNode } from 'react';

import type {
  BookingAttributeAxis,
  BusinessHours,
  DeliverySettings,
  PricingMode,
  Rate,
  TulipPublicMode,
  UnitAttributes,
} from '@louez/types';
import type { SeasonalPricingConfig } from '@louez/utils';

export interface Customer {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
}

export interface ProductPricingTier {
  id: string;
  minDuration: number | null;
  discountPercent: string | null;
  period?: number | null;
  price?: string | null;
  displayOrder: number | null;
}

export interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: string;
  deposit: string | null;
  tulipInsurable?: boolean;
  quantity: number;
  pricingMode: PricingMode | null;
  basePeriodMinutes?: number | null;
  enforceStrictTiers?: boolean;
  images: string[] | null;
  trackUnits: boolean;
  bookingAttributeAxes: BookingAttributeAxis[] | null;
  units: Array<{
    status: 'available' | 'maintenance' | 'retired';
    attributes: UnitAttributes | null;
  }>;
  pricingTiers: ProductPricingTier[];
  seasonalPricings?: SeasonalPricingConfig[];
}

export interface SelectedProduct {
  lineId: string;
  productId: string;
  quantity: number;
  selectedAttributes?: UnitAttributes;
  priceOverride?: {
    unitPrice: number;
  };
}

export interface CustomItem {
  id: string;
  name: string;
  description: string;
  unitPrice: number;
  deposit: number;
  quantity: number;
  pricingMode: PricingMode;
  basePeriodMinutes: number;
}

export interface PeriodWarning {
  type: 'advance_notice' | 'day_closed' | 'outside_hours' | 'closure_period';
  field: 'start' | 'end' | 'both';
  message: string;
  details?: string;
}

export interface AvailabilityWarning {
  productId: string;
  productName: string;
  requestedQuantity: number;
  availableQuantity: number;
  conflictingReservations?: number;
}

export type { LegMethod } from '@louez/types';

export interface DeliveryAddress {
  address: string;
  city: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

export interface DeliveryLegState {
  method: import('@louez/types').LegMethod;
  address: DeliveryAddress;
  distance: number | null;
  fee: number;
  error: string | null;
}

export interface NewReservationFormProps {
  customers: Customer[];
  products: Product[];
  tulipInsuranceMode: TulipPublicMode;
  businessHours?: BusinessHours;
  advanceNoticeMinutes?: number;
  pendingBlocksAvailability?: boolean;
  existingReservations?: Array<{
    id: string;
    startDate: Date;
    endDate: Date;
    status: string;
    items: Array<{
      productId: string | null;
      quantity: number;
      combinationKey: string | null;
    }>;
  }>;
  deliverySettings?: DeliverySettings;
  storeLatitude?: number | null;
  storeLongitude?: number | null;
  storeAddress?: string | null;
}

export type StepFieldName =
  | 'customerId'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'startDate'
  | 'endDate';

export interface NewReservationFormValues {
  customerType: 'existing' | 'new';
  customerId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  startDate: Date | undefined;
  endDate: Date | undefined;
  internalNotes: string;
}

export type ReservationStepId =
  | 'customer'
  | 'period'
  | 'products'
  | 'delivery'
  | 'confirm';

export interface ReservationStep {
  id: ReservationStepId;
  title: string;
  description: string;
}

export type StepDirection = 'forward' | 'backward';

export interface NewReservationFormComponentApi {
  AppField: ComponentType<{
    name: keyof NewReservationFormValues;
    children: (field: any) => ReactNode;
  }>;
  Field: ComponentType<{
    name: keyof NewReservationFormValues;
    children: (field: any) => ReactNode;
  }>;
}

export interface ProductPricingDetails {
  productPricingMode: PricingMode;
  productDuration: number;
  basePrice: number;
  calculatedPrice: number;
  effectivePrice: number;
  hasPriceOverride: boolean;
  hasDiscount: boolean;
  applicableTierDiscountPercent: number | null;
  hasTieredPricing: boolean;
  isRateBased: boolean;
  lineSubtotal: number;
  lineOriginalSubtotal: number;
  lineSavings: number;
  reductionPercent: number | null;
  ratePlan: Array<{ rate: Rate; quantity: number }> | null;
  basePeriodMinutes: number | null;
}
