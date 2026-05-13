import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Button, Logo } from '@louez/ui';

interface LegalPageProps {
  namespace: 'legalPages.terms' | 'legalPages.privacy';
  sectionCount: number;
}

export const LegalPage = async ({ namespace, sectionCount }: LegalPageProps) => {
  const t = await getTranslations(namespace);
  const tCommon = await getTranslations('legalPages');

  const sections = Array.from({ length: sectionCount }, (_, i) => i + 1);

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 md:py-12">
      <div className="mb-8 flex items-center justify-between">
        <Button variant="ghost" render={<Link href="/login" />}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          {tCommon('back')}
        </Button>
        <Link href="/">
          <Logo className="h-6 w-auto" />
        </Link>
      </div>

      <article className="space-y-8">
        <header className="space-y-3">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            {t('title')}
          </h1>
          <p className="text-muted-foreground text-sm">
            {tCommon('lastUpdated')}
          </p>
          <p className="text-muted-foreground text-base leading-relaxed">
            {t('intro')}
          </p>
        </header>

        <div className="space-y-8">
          {sections.map((n) => (
            <section key={n} className="space-y-2">
              <h2 className="text-xl font-semibold">
                {t(`s${n}.title`)}
              </h2>
              <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
                {t(`s${n}.body`)}
              </p>
            </section>
          ))}
        </div>

        <footer className="border-t pt-6">
          <p className="text-muted-foreground text-sm">
            {tCommon('contactPrompt')}{' '}
            <a
              href={`mailto:${tCommon('contactEmail')}`}
              className="text-primary hover:underline"
            >
              {tCommon('contactEmail')}
            </a>
          </p>
        </footer>
      </article>
    </div>
  );
};
