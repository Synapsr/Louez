/** The company form's values, as the page edits them. */
export interface CompanySettingsValues {
  country: string;
  currency: string;
  billingAddressSameAsStore: boolean;
  billingAddress: string;
  billingCity: string;
  billingPostalCode: string;
  billingCountry: string;
}

/**
 * What the company form sends to `settings.updateCompany`. The currency goes
 * only when it changed: a store set up in a currency Louez no longer offers
 * (HRK) keeps it while it saves its address.
 */
export const buildCompanyUpdate = (
  value: CompanySettingsValues,
  storedCurrency: string | null,
) => ({
  country: value.country,
  ...(value.currency !== storedCurrency ? { currency: value.currency } : {}),
  billingAddress: value.billingAddressSameAsStore
    ? { sameAsStore: true as const }
    : {
        sameAsStore: false as const,
        address: value.billingAddress,
        city: value.billingCity,
        postalCode: value.billingPostalCode,
        country: value.billingCountry,
      },
});
