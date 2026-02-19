import type { ComponentType, ReactNode } from 'react';

import type { DeliverySettings, TaxSettings } from '@louez/types';

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
  acceptCgv: boolean;
}

export type StepId = 'contact' | 'delivery' | 'address' | 'confirm';

export type DeliveryOption = 'pickup' | 'delivery';

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
}
