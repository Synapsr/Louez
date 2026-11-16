'use client';

import { useSearchParams } from 'next/navigation';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarCheck, RefreshCw, Unplug } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  Switch,
  toastManager,
} from '@louez/ui';

import { orpc } from '@/lib/orpc/react';

export const GoogleCalendarConfigurationPanel = () => {
  const t = useTranslations(
    'dashboard.settings.integrationsHub.providers.googleCalendar',
  );
  const tErrors = useTranslations('errors');
  const format = useFormatter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const stateQuery = useQuery(
    orpc.dashboard.integrations.getCalendarState.queryOptions({ input: {} }),
  );
  const oauthError = searchParams.get('error');

  const calendarState =
    stateQuery.data && !('error' in stateQuery.data)
      ? stateQuery.data.google
      : null;

  const invalidate = async () => {
    await queryClient.invalidateQueries({
      queryKey: orpc.dashboard.integrations.getCalendarState.key({
        input: {},
      }),
    });
    await queryClient.invalidateQueries({
      queryKey: orpc.dashboard.integrations.listCatalog.key({ input: {} }),
    });
    await queryClient.invalidateQueries({
      queryKey: orpc.dashboard.integrations.getDetail.key({
        input: { integrationId: 'google-calendar' },
      }),
    });
  };

  const updateSettingsMutation = useMutation(
    orpc.dashboard.integrations.updateGoogleCalendarSettings.mutationOptions({
      onSuccess: async () => {
        toastManager.add({
          type: 'success',
          title: t('panel.toasts.settingsSaved'),
        });
        await invalidate();
      },
      onError: () => {
        toastManager.add({ type: 'error', title: tErrors('generic') });
      },
    }),
  );

  const resyncMutation = useMutation(
    orpc.dashboard.integrations.resyncGoogleCalendar.mutationOptions({
      onSuccess: async () => {
        toastManager.add({
          type: 'success',
          title: t('panel.toasts.resyncStarted'),
        });
        await invalidate();
      },
      onError: () => {
        toastManager.add({ type: 'error', title: tErrors('generic') });
      },
    }),
  );

  const disconnectMutation = useMutation(
    orpc.dashboard.integrations.disconnectGoogleCalendar.mutationOptions({
      onSuccess: async () => {
        toastManager.add({
          type: 'success',
          title: t('panel.toasts.disconnected'),
        });
        await invalidate();
      },
      onError: () => {
        toastManager.add({ type: 'error', title: tErrors('generic') });
      },
    }),
  );

  if (stateQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('name')}</CardTitle>
          <CardDescription>{t('panel.loading')}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!calendarState?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('panel.connectTitle')}</CardTitle>
          <CardDescription>{t('panel.connectDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {oauthError === 'googleCalendarNotConfigured' && (
            <Alert variant="error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{t('panel.oauthNotConfigured')}</AlertDescription>
            </Alert>
          )}
          <Button
            type="button"
            onClick={() => {
              window.location.assign(
                '/api/integrations/google-calendar/oauth/start',
              );
            }}
          >
            <CalendarCheck className="mr-2 h-4 w-4" />
            {t('panel.connectAction')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{t('panel.connectionTitle')}</CardTitle>
              <CardDescription>
                {calendarState.accountEmail || t('panel.accountFallback')}
              </CardDescription>
            </div>
            <Badge
              variant={
                calendarState.status === 'active' ? 'success' : 'expired'
              }
            >
              {t(`panel.status.${calendarState.status}`)}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                {t('panel.calendarLabel')}
              </p>
              <p className="font-medium">
                {calendarState.calendarName || t('panel.calendarFallback')}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                {t('panel.lastSyncLabel')}
              </p>
              <p className="font-medium">
                {calendarState.lastSyncAt
                  ? format.dateTime(new Date(calendarState.lastSyncAt), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })
                  : t('panel.neverSynced')}
              </p>
            </div>
          </div>

          {calendarState.lastError && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-3 text-sm">
              {calendarState.lastError}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={resyncMutation.isPending}
              onClick={() => resyncMutation.mutate({})}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('panel.resyncAction')}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate({ deleteEvents: false })}
            >
              <Unplug className="mr-2 h-4 w-4" />
              {t('panel.disconnectAction')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('panel.syncRulesTitle')}</CardTitle>
          <CardDescription>{t('panel.syncRulesDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="google-calendar-sync-pending">
                {t('panel.syncPendingLabel')}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t('panel.syncPendingDescription')}
              </p>
            </div>
            <Switch
              id="google-calendar-sync-pending"
              checked={calendarState.syncPendingReservations}
              onCheckedChange={(checked) =>
                updateSettingsMutation.mutate({
                  syncPendingReservations: checked,
                  cancelledReservationBehavior:
                    calendarState.cancelledReservationBehavior,
                })
              }
            />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="google-calendar-show-cancelled">
                {t('panel.showCancelledLabel')}
              </Label>
              <p className="text-muted-foreground text-sm">
                {t('panel.showCancelledDescription')}
              </p>
            </div>
            <Switch
              id="google-calendar-show-cancelled"
              checked={calendarState.cancelledReservationBehavior === 'show'}
              onCheckedChange={(checked) =>
                updateSettingsMutation.mutate({
                  syncPendingReservations:
                    calendarState.syncPendingReservations,
                  cancelledReservationBehavior: checked ? 'show' : 'hide',
                })
              }
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
