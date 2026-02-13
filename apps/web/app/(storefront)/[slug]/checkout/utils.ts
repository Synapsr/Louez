import type { DeliveryOption, StepId } from './types';

export function calculateDuration(
  startDate: string,
  endDate: string,
  pricingMode: 'day' | 'hour' | 'week',
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffMs = end.getTime() - start.getTime();

  switch (pricingMode) {
    case 'hour':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    case 'week':
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)));
    default:
      return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  }
}

interface StepOptions {
  isDeliveryEnabled: boolean;
  deliveryOption: DeliveryOption;
  requireCustomerAddress: boolean;
}

export function getCheckoutStepIds({
  isDeliveryEnabled,
  deliveryOption,
  requireCustomerAddress,
}: StepOptions): StepId[] {
  const steps: StepId[] = ['contact'];

  if (isDeliveryEnabled) {
    steps.push('delivery');
  }

  if (deliveryOption === 'delivery' || requireCustomerAddress) {
    steps.push('address');
  }

  steps.push('confirm');
  return steps;
}

export function sanitizeTranslationParams(
  params: Record<string, unknown> | undefined,
): Record<string, string | number> {
  if (!params) return {};

  const cleaned: Record<string, string | number> = {};

  for (const [key, value] of Object.entries(params)) {
    if (
      value !== undefined &&
      value !== null &&
      (typeof value === 'string' || typeof value === 'number')
    ) {
      cleaned[key] = value;
    }
  }

  return cleaned;
}

