import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LegalPage } from '../_components/legal-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legalPages.terms');
  return {
    title: t('title'),
    description: t('intro'),
  };
}

export default function TermsPage() {
  return <LegalPage namespace="legalPages.terms" sectionCount={9} />;
}
