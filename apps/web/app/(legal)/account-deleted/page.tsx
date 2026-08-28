import Link from 'next/link';
import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { Button, Card, CardContent, CardHeader, CardTitle } from '@louez/ui';

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations('dashboard.settings.accountSettings.accountDeletion');
  return { title: t('deletedTitle') };
};

const AccountDeletedPage = async () => {
  const t = await getTranslations('dashboard.settings.accountSettings.accountDeletion');

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t('deletedTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">{t('deletedDescription')}</p>
          <Button render={<Link href="/" />} variant="outline">
            {t('backHome')}
          </Button>
        </CardContent>
      </Card>
    </main>
  );
};

export default AccountDeletedPage;
