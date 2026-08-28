import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { auth } from '@/lib/auth';

import { AccountDeletionConfirmation } from './account-deletion-confirmation';

export const instant = false;

export const generateMetadata = async (): Promise<Metadata> => {
  const t = await getTranslations('dashboard.settings.accountSettings.accountDeletion');
  return { title: t('confirmPageTitle') };
};

const AccountDeletionConfirmationPage = async () => {
  const session = await auth();
  return <AccountDeletionConfirmation isAuthenticated={Boolean(session?.user.id)} />;
};

export default AccountDeletionConfirmationPage;
