import type { UnitAttributes } from '@louez/types';
import { formatCurrency } from '@louez/utils';

import { formatDate } from '@/lib/utils';

import type { InventoryUnitRow } from '../queries';

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

export const toDateTimeLocalInputValue = (
  value: Date | string | null | undefined,
) => {
  const date = value
    ? typeof value === 'string'
      ? new Date(value)
      : value
    : new Date();

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
};

export const parseOptionalDate = (value: string) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

export const formatPurchaseInfo = (row: InventoryUnitRow, currency: string) => {
  const parts: string[] = [];

  if (row.purchasePrice) {
    parts.push(formatCurrency(parseFloat(row.purchasePrice), currency));
  }

  if (row.purchasedAt) {
    parts.push(formatDate(row.purchasedAt));
  }

  return parts.join(' · ');
};
