'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useDashboardBreadcrumbs } from './dashboard-breadcrumbs-context';

const breadcrumbRoutes = [
  { href: '/dashboard/ai-assistant', key: 'aiAssistant' },
  { href: '/dashboard/products/new', key: 'productsNew' },
  { href: '/dashboard/products', key: 'products' },
  { href: '/dashboard/reservations/new', key: 'reservationsNew' },
  { href: '/dashboard/reservations', key: 'reservations' },
  { href: '/dashboard/customers/new', key: 'customersNew' },
  { href: '/dashboard/customers', key: 'customers' },
  { href: '/dashboard/calendar', key: 'calendar' },
  { href: '/dashboard/analytics', key: 'analytics' },
  { href: '/dashboard/team', key: 'team' },
  { href: '/dashboard/referrals', key: 'referrals' },
  { href: '/dashboard/sms', key: 'sms' },
  { href: '/dashboard/subscription', key: 'subscription' },
  { href: '/dashboard/account', key: 'account' },
  { href: '/dashboard/settings/admin', key: 'settingsAdmin' },
  { href: '/dashboard/settings/api', key: 'settingsApi' },
  { href: '/dashboard/settings/appearance', key: 'settingsAppearance' },
  { href: '/dashboard/settings/delivery', key: 'settingsDelivery' },
  { href: '/dashboard/settings/embed', key: 'settingsEmbed' },
  { href: '/dashboard/settings/export', key: 'settingsExport' },
  { href: '/dashboard/settings/hours', key: 'settingsHours' },
  { href: '/dashboard/settings/inspections', key: 'settingsInspections' },
  { href: '/dashboard/settings/integrations', key: 'settingsIntegrations' },
  { href: '/dashboard/settings/legal', key: 'settingsLegal' },
  { href: '/dashboard/settings/notifications', key: 'settingsNotifications' },
  { href: '/dashboard/settings/payments', key: 'settingsPayments' },
  { href: '/dashboard/settings/promo-codes', key: 'settingsPromoCodes' },
  { href: '/dashboard/settings/review-booster', key: 'settingsReviewBooster' },
  { href: '/dashboard/settings/taxes', key: 'settingsTaxes' },
  { href: '/dashboard/settings', key: 'settings' },
] satisfies { href: string; key: string }[];

const getCurrentRoute = (pathname: string) => {
  if (pathname === '/dashboard') {
    return null;
  }

  return (
    breadcrumbRoutes.find(
      (route) =>
        pathname === route.href || pathname.startsWith(`${route.href}/`),
    ) || null
  );
};

const getDynamicLabel = (
  pathname: string,
  route: { href: string; key: string } | null,
  labels: Record<string, string>,
) => {
  if (!route || pathname === route.href) {
    return null;
  }

  if (route.key.endsWith('New')) {
    return null;
  }

  return labels[pathname] || null;
};

export const DashboardBreadcrumbs = () => {
  const pathname = usePathname();
  const t = useTranslations('dashboard.breadcrumbs');
  const { labels } = useDashboardBreadcrumbs();
  const currentRoute = getCurrentRoute(pathname);
  const dynamicLabel = getDynamicLabel(pathname, currentRoute, labels);

  return (
    <nav aria-label={t('label')} className="ml-1 min-w-0 flex-1 overflow-hidden">
      <ol className="text-muted-foreground flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
        <li className="shrink-0">
          {currentRoute ? (
            <Link
              href="/dashboard"
              className="hover:text-foreground transition-colors"
            >
              {t('home')}
            </Link>
          ) : (
            <span className="text-foreground font-medium">{t('home')}</span>
          )}
        </li>
        {currentRoute && (
          <>
            <li aria-hidden="true" className="shrink-0">
              <ChevronRight className="h-3.5 w-3.5" />
            </li>
            {currentRoute.href.startsWith('/dashboard/settings/') && (
              <>
                <li className="hidden shrink-0 md:block">
                  <Link
                    href="/dashboard/settings"
                    className="hover:text-foreground transition-colors"
                  >
                    {t('settings')}
                  </Link>
                </li>
                <li aria-hidden="true" className="hidden shrink-0 md:block">
                  <ChevronRight className="h-3.5 w-3.5" />
                </li>
              </>
            )}
            <li className="min-w-0">
              {dynamicLabel ? (
                <Link
                  href={currentRoute.href}
                  className="hover:text-foreground block truncate transition-colors"
                >
                  {t(currentRoute.key)}
                </Link>
              ) : (
                <span className="text-foreground block truncate font-medium">
                  {t(currentRoute.key)}
                </span>
              )}
            </li>
            {dynamicLabel && (
              <>
                <li aria-hidden="true" className="shrink-0">
                  <ChevronRight className="h-3.5 w-3.5" />
                </li>
                <li className="min-w-0">
                  <span className="text-foreground block truncate font-medium">
                    {dynamicLabel}
                  </span>
                </li>
              </>
            )}
          </>
        )}
      </ol>
    </nav>
  );
};
