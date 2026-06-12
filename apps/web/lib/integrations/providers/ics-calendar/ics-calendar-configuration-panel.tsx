'use client';

import { useEffect, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { Check, Copy, RefreshCw } from 'lucide-react';

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
} from '@/app/(dashboard)/dashboard/calendar/actions';

export const IcsCalendarConfigurationPanel = () => {
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
      toastManager.add({ type: 'success', title: 'Lien ICS regenere' });
    }
    setRegenerating(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lien ICS</CardTitle>
        <CardDescription>
          Compatible Apple Calendar, Outlook et les agendas par abonnement.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ics-url">Lien calendrier</Label>
          <div className="flex gap-2">
            <Input
              id="ics-url"
              readOnly
              value={loading ? 'Chargement...' : url}
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
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
          Louez publie les changements immediatement, mais la frequence de
          rafraichissement depend de l'application d'agenda abonne.
        </p>

        <Button
          type="button"
          variant="outline"
          disabled={regenerating}
          onClick={regenerate}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Regenerer le lien
        </Button>
      </CardContent>
    </Card>
  );
};
