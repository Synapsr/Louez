'use client';

import { useCallback, useRef } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, Braces, Code, Terminal } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Alert, AlertDescription, Badge, Card, Skeleton } from '@louez/ui';

import type { IntegrationCatalogItem } from '@/lib/integrations/registry/types';
import { orpc } from '@/lib/orpc/react';

type BuiltInItem = {
  id: string;
  href: string;
  icon: React.ElementType;
  nameKey: string;
  descriptionKey: string;
  badge?: {
    labelKey: string;
    variant: 'default' | 'secondary' | 'outline';
  };
};

const LOUEZ_ITEMS: BuiltInItem[] = [
  {
    id: 'widget',
    href: '/dashboard/settings/integrations/widget',
    icon: Code,
    nameKey: 'dashboard.settings.integrationsHub.builtIn.widget.name',
    descriptionKey:
      'dashboard.settings.integrationsHub.builtIn.widget.description',
    badge: {
      labelKey: 'dashboard.settings.integrationsHub.recommended',
      variant: 'default',
    },
  },
  {
    id: 'mcp',
    href: '/dashboard/settings/integrations/mcp',
    icon: Terminal,
    nameKey: 'dashboard.settings.integrationsHub.builtIn.mcp.name',
    descriptionKey:
      'dashboard.settings.integrationsHub.builtIn.mcp.description',
  },
  {
    id: 'api',
    href: '/dashboard/settings/integrations/api',
    icon: Braces,
    nameKey: 'dashboard.settings.integrationsHub.builtIn.api.name',
    descriptionKey:
      'dashboard.settings.integrationsHub.builtIn.api.description',
    badge: {
      labelKey: 'dashboard.settings.integrationsHub.comingSoon',
      variant: 'secondary',
    },
  },
];

const TULIP_INTEGRATION_ID = 'tulip';

function IntegrationItemCard({
  href,
  icon: Icon,
  logo,
  name,
  description,
  badge,
  onPrefetch,
}: {
  href: string;
  icon?: React.ElementType;
  logo?: string;
  name: string;
  description: string;
  badge?: {
    label: string;
    variant: 'default' | 'secondary' | 'outline' | 'success';
  };
  onPrefetch?: () => void;
}) {
  return (
    <Link
      href={href}
      onFocus={onPrefetch}
      onMouseEnter={onPrefetch}
      onTouchStart={onPrefetch}
    >
      <Card className="group hover:border-primary/40 hover:bg-muted/30 h-full px-5 py-4 transition">
        <div className="flex items-start gap-4">
          {Icon ? (
            <div className="bg-primary/10 text-primary flex h-11 w-11 shrink-0 items-center justify-center rounded-xl">
              <Icon className="h-5 w-5" />
            </div>
          ) : logo ? (
            <div className="bg-background h-11 w-11 shrink-0 overflow-hidden rounded-xl border p-1.5">
              <img
                src={logo}
                alt={name}
                className="h-full w-full object-contain"
              />
            </div>
          ) : null}
          <div className="min-w-0 flex-1 py-0.5">
            <div className="flex items-center gap-2">
              <span className="font-medium">{name}</span>
              {badge && (
                <Badge
                  variant={badge.variant}
                  className="px-1.5 py-0 text-[10px]"
                >
                  {badge.label}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
              {description}
            </p>
          </div>
          <ArrowRight className="text-muted-foreground mt-1 h-4 w-4 shrink-0 opacity-0 transition group-hover:opacity-100" />
        </div>
      </Card>
    </Link>
  );
}

export function IntegrationsCatalogView() {
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const prefetchedIntegrationsRef = useRef<Set<string>>(new Set());

  const resolveMessage = (key: string, fallback: string): string => {
    try {
      const value = t(key as never);
      if (!value || value === key) return fallback;
      return value;
    } catch {
      return fallback;
    }
  };

  const catalogQuery = useQuery({
    ...orpc.dashboard.integrations.listCatalog.queryOptions({ input: {} }),
  });

  const prefetchRoute = useCallback(
    (href: string) => {
      router.prefetch(href);
    },
    [router],
  );

  const prefetchIntegration = useCallback(
    (integrationId: string) => {
      const href = `/dashboard/settings/integrations/${integrationId}`;
      prefetchRoute(href);

      if (prefetchedIntegrationsRef.current.has(integrationId)) {
        return;
      }

      prefetchedIntegrationsRef.current.add(integrationId);

      void queryClient.prefetchQuery(
        orpc.dashboard.integrations.getDetail.queryOptions({
          input: { integrationId },
        }),
      );

      if (integrationId === TULIP_INTEGRATION_ID) {
        void queryClient.prefetchQuery(
          orpc.dashboard.integrations.getTulipState.queryOptions({
            input: {},
          }),
        );
      }
    },
    [prefetchRoute, queryClient],
  );

  const catalogLoadError =
    catalogQuery.isError ||
    (catalogQuery.data ? 'error' in catalogQuery.data : false);

  const integrations: IntegrationCatalogItem[] =
    catalogQuery.data && !('error' in catalogQuery.data)
      ? (catalogQuery.data.integrations as unknown as IntegrationCatalogItem[])
      : [];

  const insuranceIntegrations = integrations.filter(
    (i) => i.category === 'insurance',
  );
  const calendarIntegrations = integrations.filter(
    (i) => i.category === 'calendar',
  );

  return (
    <div className="space-y-10">
      {/* Built-in by Louez.io */}
      <section className="space-y-3">
        <h3 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
          {resolveMessage(
            'dashboard.settings.integrationsHub.sections.byLouez',
            'By Louez.io',
          )}
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {LOUEZ_ITEMS.map((item) => (
            <IntegrationItemCard
              key={item.id}
              href={item.href}
              icon={item.icon}
              name={resolveMessage(item.nameKey, item.id)}
              description={resolveMessage(item.descriptionKey, '')}
              onPrefetch={() => prefetchRoute(item.href)}
              badge={
                item.badge
                  ? {
                      label: resolveMessage(item.badge.labelKey, ''),
                      variant: item.badge.variant,
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </section>

      {catalogLoadError && (
        <Alert variant="error">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {resolveMessage(
              'dashboard.settings.integrationsHub.loadError',
              'Unable to load integrations.',
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* Calendar */}
      {!catalogLoadError && (
        <section className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {resolveMessage(
              'dashboard.settings.integrationsHub.sections.calendar',
              'Calendar',
            )}
          </h3>
          {catalogQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-[84px] rounded-lg" />
              <Skeleton className="h-[84px] rounded-lg" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {calendarIntegrations.map((item) => (
                <IntegrationItemCard
                  key={item.id}
                  href={`/dashboard/settings/integrations/${item.id}`}
                  logo={item.logoPath}
                  name={resolveMessage(item.nameKey, item.id)}
                  description={resolveMessage(item.descriptionKey, '')}
                  onPrefetch={() => prefetchIntegration(item.id)}
                  badge={
                    item.connected
                      ? {
                          label: resolveMessage(
                            'dashboard.settings.integrationsHub.statusLabels.connected',
                            'Connected',
                          ),
                          variant: 'success',
                        }
                      : undefined
                  }
                />
              ))}
              {!catalogQuery.isLoading && calendarIntegrations.length === 0 && (
                <p className="text-muted-foreground text-sm">
                  {resolveMessage(
                    'dashboard.settings.integrationsHub.noIntegrations',
                    'No integrations available yet.',
                  )}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* Insurance */}
      {!catalogLoadError && (
        <section className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            {resolveMessage(
              'dashboard.settings.integrationsHub.sections.insurance',
              'Insurance',
            )}
          </h3>
          {catalogQuery.isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Skeleton className="h-[84px] rounded-lg" />
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {insuranceIntegrations.map((item) => (
                <IntegrationItemCard
                  key={item.id}
                  href={`/dashboard/settings/integrations/${item.id}`}
                  logo={item.logoPath}
                  name={resolveMessage(item.nameKey, item.id)}
                  description={resolveMessage(item.descriptionKey, '')}
                  onPrefetch={() => prefetchIntegration(item.id)}
                  badge={
                    item.enabled
                      ? {
                          label: resolveMessage(
                            'dashboard.settings.integrationsHub.statusLabels.enabled',
                            'Enabled',
                          ),
                          variant: 'success',
                        }
                      : undefined
                  }
                />
              ))}
              {!catalogQuery.isLoading &&
                insuranceIntegrations.length === 0 && (
                  <p className="text-muted-foreground text-sm">
                    {resolveMessage(
                      'dashboard.settings.integrationsHub.noIntegrations',
                      'No integrations available yet.',
                    )}
                  </p>
                )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
