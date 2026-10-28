'use client';

import Link from 'next/link';

import { useTranslations } from 'next-intl';

import { useInstanceConfig } from '@/components/instance-provider';

const linkClassName = 'hover:text-primary underline underline-offset-4';

/**
 * The sign-in page's legal footer. `/terms` is Louez Cloud's terms of service, which bind
 * only its customers, so an instance that does not bill its stores links the privacy
 * policy alone (louez-billing docs/plans/design.md §7.2).
 */
export function LoginLegalNotice() {
  const t = useTranslations('auth');
  const { billingEnabled } = useInstanceConfig();
  const privacyLink = (
    <Link href="/privacy" target="_blank" rel="noopener noreferrer" className={linkClassName}>
      {t('privacyPolicy')}
    </Link>
  );

  return (
    <p className="text-muted-foreground absolute right-6 bottom-2 left-6 text-center text-[13.5px] lg:right-12 lg:bottom-2.5 lg:left-12">
      {billingEnabled ? (
        <>
          {t('termsAgreement')}{' '}
          <Link href="/terms" target="_blank" rel="noopener noreferrer" className={linkClassName}>
            {t('termsOfService')}
          </Link>{' '}
          {t('and')} {privacyLink}
        </>
      ) : (
        privacyLink
      )}
    </p>
  );
}
