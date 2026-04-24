import type { ComponentType, ReactNode } from 'react';

import type {
  DeliverySettings,
  LegMethod,
  TaxSettings,
} from '@louez/types';

export type { LegMethod } from '@louez/types';

export interface CheckoutFormProps {
  storeSlug: string;
  storeId: string;
  pricingMode: 'day' | 'hour' | 'week';
  reservationMode: 'payment' | 'request';
  requireCustomerAddress: boolean;
  cgv: string | null;
  taxSettings?: TaxSettings;
  depositPercentage?: number;
  deliverySettings?: DeliverySettings;
  storeAddress?: string | null;
  storeLatitude?: number | null;
  storeLongitude?: number | null;
  tulipInsurance?: {
    enabled: boolean;
    mode: 'required' | 'optional' | 'no_public';
  };
  hasActivePromoCodes?: boolean;
}

export interface CheckoutFormValues {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  isBusinessCustomer: boolean;
  companyName: string;
  address: string;
  city: string;
  postalCode: string;
  notes: string;
  tulipInsuranceOptIn: boolean;
  acceptCgv: boolean;
}

export type StepId = 'contact' | 'delivery' | 'address' | 'confirm';

export interface CheckoutStep {
  id: StepId;
  icon: ComponentType<{ className?: string }>;
}

export interface DeliveryAddress {
  address: string;
  city: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
}

/**
 * State for a single delivery leg (outbound or return).
 */
export interface DeliveryLegState {
  method: LegMethod;
  address: DeliveryAddress;
  distance: number | null;
  fee: number;
  error: string | null;
}

export type LineResolutionState =
  | { status: 'loading' }
  | {
      status: 'resolved';
      combinationKey: string;
      selectedAttributes: Record<string, string>;
    }
  | { status: 'invalid' };

export interface CheckoutFormComponentApi {
  AppField: ComponentType<{
    name: keyof CheckoutFormValues;
    children: (field: any) => ReactNode;
  }>;
  Field: ComponentType<{
    name: keyof CheckoutFormValues;
    children: (field: any) => ReactNode;
  }>;
  Subscribe: ComponentType<{
    selector: (state: any) => unknown;
    children: (value: any) => ReactNode;
  }>;
  getFieldValue: <K extends keyof CheckoutFormValues>(
    field: K,
  ) => CheckoutFormValues[K];
  setFieldValue: (field: keyof CheckoutFormValues, value: any) => void;
}
