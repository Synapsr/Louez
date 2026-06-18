'use client';

import { BellOff, BellRing } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toastManager,
} from '@louez/ui';

import { usePushSubscription } from '@/hooks/use-push-subscription';

/**
 * Manage push notifications for the current device. Lives in
 * Settings → Notifications. Hidden where push is unsupported or still loading.
 */
export function PushManageCard() {
  const t = useTranslations('dashboard.settings.notifications.push');
  const { state, busy, enable, disable } = usePushSubscription();

  if (state === 'loading' || state === 'unsupported') return null;

  const handleEnable = async () => {
    const ok = await enable();
    if (!ok) return;
    toastManager.add({ title: t('confirmTitle'), type: 'success' });
    // A real notification doubles as proof the pipeline works end to end.
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(t('confirmTitle'), {
        body: t('confirmBody'),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
      });
    } catch {
      /* showNotification can be unavailable — the toast already confirmed */
    }
  };

  const handleDisable = async () => {
    await disable();
    toastManager.add({ title: t('disabledToast') });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="size-4" />
          {t('title')}
        </CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {state === 'ios-needs-install' && (
          <p className="text-muted-foreground text-sm">{t('iosNeedsInstall')}</p>
        )}

        {state === 'denied' && (
          <p className="text-muted-foreground text-sm">{t('denied')}</p>
        )}

        {state === 'prompt' && (
          <Button onClick={handleEnable} isPending={busy}>
            <BellRing />
            {t('enable')}
          </Button>
        )}

        {state === 'subscribed' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-success text-sm font-medium">{t('enabled')}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDisable}
              isPending={busy}
            >
              <BellOff />
              {t('disable')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
