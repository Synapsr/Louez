'use client';

import { useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  toastManager,
} from '@louez/ui';

import { orpc } from '@/lib/orpc/react';

import {
  getIcsToken,
  regenerateIcsToken,
} from '@/app/(dashboard)/dashboard/reservations/calendar/actions';

export const IcsCalendarConfigurationPanel = () => {
  const t = useTranslations(
    'dashboard.settings.integrationsHub.providers.icsCalendar',
  );
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const stateQuery = useQuery(
    orpc.dashboard.integrations.getCalendarState.queryOptions({ input: {} }),
  );
  const storeId =
    stateQuery.data && !('error' in stateQuery.data)
      ? stateQuery.data.storeId
      : null;

  useEffect(() => {
    let mounted = true;

    const loadToken = async () => {
      const result = await getIcsToken();
      if (mounted && result.success && result.token) {
        setToken(result.token);
      }
      if (mounted) setLoading(false);
    };

    void loadToken();
    return () => {
      mounted = false;
    };
  }, []);

  const url =
    typeof window !== 'undefined' && token && storeId
      ? `${window.location.origin}/api/calendar/ics?store=${storeId}&token=${token}`
      : '';

  const copyUrl = async () => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerate = async () => {
    setRegenerating(true);
    const result = await regenerateIcsToken();
    if (result.success && result.token) {
      setToken(result.token);
      toastManager.add({
        type: 'success',
        title: t('panel.toasts.regenerated'),
      });
    }
    setRegenerating(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('name')}</CardTitle>
        <CardDescription>{t('panel.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ics-url">{t('panel.urlLabel')}</Label>
          <div className="flex gap-2">
            <Input
              id="ics-url"
              readOnly
              value={loading ? t('panel.loading') : url}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t('panel.copyAction')}
              title={t('panel.copyAction')}
              disabled={!url}
              onClick={copyUrl}
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        <p className="text-muted-foreground text-sm">
          {t('panel.refreshNote')}
        </p>

        <Button
          type="button"
          variant="outline"
          disabled={regenerating}
          onClick={regenerate}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {t('panel.regenerateAction')}
        </Button>
      </CardContent>
    </Card>
  );
};
