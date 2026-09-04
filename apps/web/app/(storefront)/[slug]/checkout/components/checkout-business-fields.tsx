'use client';

import { useTranslations } from 'next-intl';

import type { CompanySearchResult } from '@/lib/recherche-entreprises';

import type { CheckoutFormComponentApi } from '../types';
import { CheckoutCompanySearchField } from './checkout-company-search-field';

interface CheckoutBusinessFieldsProps {
  form: CheckoutFormComponentApi;
  storeId: string;
  /** ISO-2 country of the store — decides the identifier wording and lookup. */
  country: string;
}

/**
 * Company identity of a business buyer. Only the company name is required:
 * SIREN and VAT number stay optional so a buyer in a hurry is never blocked —
 * their invoice simply degrades to B2C.
 */
export const CheckoutBusinessFields = ({
  form,
  storeId,
  country,
}: CheckoutBusinessFieldsProps) => {
  const t = useTranslations('storefront.checkout');

  const companyNumberLabel =
    country === 'FR'
      ? t('companyNumberSiren')
      : country === 'BE'
        ? t('companyNumberBce')
        : t('companyNumber');

  const handleCompanySelect = (company: CompanySearchResult) => {
    form.setFieldValue('companyName', company.legalName);
    form.setFieldValue('companyNumber', company.siren);
    form.setFieldValue('vatNumber', company.vatNumber);
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      {country === 'FR' && (
        <CheckoutCompanySearchField
          storeId={storeId}
          onSelect={handleCompanySelect}
        />
      )}

      <form.AppField name="companyName">
        {(field) => (
          <field.Input
            label={`${t('companyName')} *`}
            placeholder={t('companyNamePlaceholder')}
          />
        )}
      </form.AppField>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.AppField name="companyNumber">
          {(field) => (
            <field.Input
              label={companyNumberLabel}
              placeholder={t('companyNumberPlaceholder')}
              description={t('companyNumberHelp')}
              inputMode="numeric"
              autoComplete="off"
            />
          )}
        </form.AppField>

        <form.AppField name="vatNumber">
          {(field) => (
            <field.Input
              label={t('vatNumber')}
              placeholder={t('vatNumberPlaceholder')}
              autoComplete="off"
            />
          )}
        </form.AppField>
      </div>
    </div>
  );
};
