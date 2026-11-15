interface LocationAddressParts {
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

/**
 * Store addresses are often stored as a single line that already ends with the
 * postal code and city, so only append the parts the address does not contain.
 */
export function formatLocationAddress({
  address,
  city,
  postalCode,
}: LocationAddressParts): string | null {
  const base = address?.trim() || '';
  const missingParts = [postalCode, city]
    .filter((part): part is string => Boolean(part))
    .filter((part) => !base.toLowerCase().includes(part.toLowerCase()));
  const suffix = missingParts.join(' ');

  return [base, suffix].filter(Boolean).join(', ') || null;
}
