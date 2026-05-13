import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { LegalPage } from '../_components/legal-page';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('legalPages.privacy');
  return {
    title: t('title'),
    description: t('intro'),
  };
}

export default function PrivacyPage() {
  return <LegalPage namespace="legalPages.privacy" sectionCount={8} />;
}
