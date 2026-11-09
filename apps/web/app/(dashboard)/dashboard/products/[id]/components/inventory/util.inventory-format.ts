import type { UnitAttributes } from '@louez/types';
import { formatCurrency } from '@louez/utils';

import { apiErrorKey } from '@/lib/orpc/errors';
import { formatDate } from '@/lib/utils';

import type { ProductInventoryUnit } from '../../queries';

export const formatUnitAttributes = (attributes: UnitAttributes | null) => {
  if (!attributes) {
    return null;
  }

  const entries = Object.entries(attributes).filter(([, value]) =>
    value.trim(),
  );
  if (entries.length === 0) {
    return null;
  }

  return entries.map(([key, value]) => `${key}: ${value}`).join(' · ');
};

export const getTranslatedActionError = (
  error: string,
  translateError: (key: string) => string,
) => {
  if (!error.startsWith('errors.')) {
    return error;
  }

  return translateError(error.slice('errors.'.length));
};

type TranslateError = ((key: string) => string) & {
  has: (key: string) => boolean;
};

/** The translated message of a failed procedure call, or the generic one. */
export const getApiErrorMessage = (
  error: unknown,
  translateError: TranslateError,
) => {
  const key = apiErrorKey(error);
  return key && translateError.has(key)
    ? translateError(key)
    : translateError('generic');
};

export const formatPurchaseInfo = (
  unit: ProductInventoryUnit,
  currency: string,
  locale?: string,
) => {
  const parts: string[] = [];

  if (unit.purchasePrice) {
    parts.push(formatCurrency(parseFloat(unit.purchasePrice), currency, locale));
  }

  if (unit.purchasedAt) {
    parts.push(formatDate(unit.purchasedAt, undefined, locale));
  }

  return parts.join(' · ');
};
