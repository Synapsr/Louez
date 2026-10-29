import { connection } from 'next/server';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requirePlatformBilling } from '@/lib/billing/require-billing';

import { LegalPage } from '../_components/legal-page';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legalPages.terms');
  return {
    title: t('title'),
    description: t('intro'),
  };
}

/** Louez Cloud's terms of service: an instance that does not bill its stores has none. */
export default async function TermsPage() {
  // Read LOUEZ_BILLING at request time: before a dynamic API, Cache Components
  // would run this check during the build, which has no LOUEZ_BILLING, and serve a 404.
  await connection();
  requirePlatformBilling();
  return <LegalPage namespace="legalPages.terms" sectionCount={9} />;
}
