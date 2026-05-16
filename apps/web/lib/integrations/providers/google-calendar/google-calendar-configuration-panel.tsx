'use client';

import { useSearchParams } from 'next/navigation';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarCheck, RefreshCw, Unplug } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
  const t = useTranslations();
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
        toastManager.add({ type: 'success', title: 'Parametres enregistres' });
        await invalidate();
      },
      onError: () => {
        toastManager.add({ type: 'error', title: t('errors.generic') });
      },
    }),
  );

  const resyncMutation = useMutation(
    orpc.dashboard.integrations.resyncGoogleCalendar.mutationOptions({
      onSuccess: async () => {
        toastManager.add({
          type: 'success',
          title: 'Resynchronisation lancee',
        });
        await invalidate();
      },
      onError: () => {
        toastManager.add({ type: 'error', title: t('errors.generic') });
      },
    }),
  );

  const disconnectMutation = useMutation(
    orpc.dashboard.integrations.disconnectGoogleCalendar.mutationOptions({
      onSuccess: async () => {
        toastManager.add({
          type: 'success',
          title: 'Google Calendar deconnecte',
        });
        await invalidate();
      },
      onError: () => {
        toastManager.add({ type: 'error', title: t('errors.generic') });
      },
    }),
  );

  if (stateQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Google Calendar</CardTitle>
          <CardDescription>Chargement de la connexion...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!calendarState?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connecter Google Calendar</CardTitle>
          <CardDescription>
            Louez creera un agenda dedie et y synchronisera les reservations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {oauthError === 'googleCalendarNotConfigured' && (
            <Alert variant="error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                Google Calendar OAuth n'est pas configure. Ajoutez
                GOOGLE_CALENDAR_CLIENT_ID et GOOGLE_CALENDAR_CLIENT_SECRET dans
                apps/web/.env, puis redemarrez le serveur de dev.
              </AlertDescription>
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
            Connecter Google Calendar
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
              <CardTitle>Connexion Google Calendar</CardTitle>
              <CardDescription>
                {calendarState.accountEmail || 'Compte Google connecte'}
              </CardDescription>
            </div>
            <Badge
              variant={
                calendarState.status === 'active' ? 'success' : 'secondary'
              }
            >
              {calendarState.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Agenda
              </p>
              <p className="font-medium">
                {calendarState.calendarName || 'Agenda Louez'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                Derniere synchronisation
              </p>
              <p className="font-medium">
                {calendarState.lastSyncAt
                  ? new Date(calendarState.lastSyncAt).toLocaleString()
                  : 'Pas encore synchronise'}
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
              Resynchroniser
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disconnectMutation.isPending}
              onClick={() => disconnectMutation.mutate({ deleteEvents: false })}
            >
              <Unplug className="mr-2 h-4 w-4" />
              Deconnecter
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Regles de synchronisation</CardTitle>
          <CardDescription>
            Les evenements synchronises sont prives et ne bloquent pas votre
            disponibilite Google.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="google-calendar-sync-pending">
                Synchroniser les demandes en attente
              </Label>
              <p className="text-muted-foreground text-sm">
                Les demandes en attente apparaissent avec un statut provisoire.
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
                Afficher les réservations annulées dans l'agenda
              </Label>
              <p className="text-muted-foreground text-sm">
                Les reservations annulees restent visibles avec leur statut
                d'annulation.
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
