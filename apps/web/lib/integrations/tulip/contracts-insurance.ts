const LEGACY_INSURANCE_LABELS = ['garantie casse/vol', 'breakage/theft coverage'];

function getLegacyTulipInsuranceAmount(
  items: Array<{
    isCustomItem: boolean;
    productSnapshot: unknown;
    totalPrice: string;
  }>,
): number {
  let total = 0;

  for (const item of items) {
    if (!item.isCustomItem) {
      continue;
    }

    const snapshotName =
      item.productSnapshot && typeof item.productSnapshot === 'object'
        ? (item.productSnapshot as { name?: unknown }).name
        : null;

    const normalizedName =
      typeof snapshotName === 'string' ? snapshotName.trim().toLowerCase() : '';

    if (!LEGACY_INSURANCE_LABELS.includes(normalizedName)) {
      continue;
    }

    const parsedAmount = Number(item.totalPrice);
    if (Number.isFinite(parsedAmount) && parsedAmount > 0) {
      total += parsedAmount;
    }
  }

  return Math.round(total * 100) / 100;
}

export function getReservationInsuranceSelection(reservation: {
  tulipInsuranceOptIn: boolean | null;
  tulipInsuranceAmount: string | null;
  items: Array<{
    isCustomItem: boolean;
    productSnapshot: unknown;
    totalPrice: string;
  }>;
}): { optIn: boolean; amount: number } {
  if (reservation.tulipInsuranceOptIn === null && reservation.tulipInsuranceAmount === null) {
    const legacyAmount = getLegacyTulipInsuranceAmount(reservation.items);
    return {
      optIn: legacyAmount > 0,
      amount: legacyAmount,
    };
  }

  const parsedAmount = Number(reservation.tulipInsuranceAmount ?? '0');
  return {
    optIn: reservation.tulipInsuranceOptIn === true,
    amount: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 0,
  };
}
