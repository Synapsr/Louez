'use client';

import { Fragment } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useDashboardBreadcrumbs } from './dashboard-breadcrumbs-context';
import { getDashboardBreadcrumbItems } from './util.dashboard-breadcrumbs';

/** `inert` shows the trail without its links, where there is nowhere to go: a demo scene. */
export const DashboardBreadcrumbs = ({ inert = false }: { inert?: boolean }) => {
  const currentPathname = usePathname();
  const t = useTranslations('dashboard.breadcrumbs');
  const { labels, pathname: providedPathname } = useDashboardBreadcrumbs();
  const pathname = providedPathname ?? currentPathname;
  const breadcrumbItems = getDashboardBreadcrumbItems(pathname, labels);

  return (
    <nav
      aria-label={t('label')}
      className="ml-1 min-w-0 flex-1 overflow-hidden"
    >
      <ol className="text-muted-foreground flex min-w-0 items-center gap-1.5 overflow-hidden text-sm">
        <li className="shrink-0">
          {pathname !== '/dashboard' && !inert ? (
            <Link
              href="/dashboard"
              className="hover:text-foreground transition-colors"
            >
              {t('home')}
            </Link>
          ) : (
            <span
              className={
                pathname === '/dashboard'
                  ? 'text-foreground font-medium'
                  : undefined
              }
            >
              {t('home')}
            </span>
          )}
        </li>
        {breadcrumbItems.map((item) => {
          const isCurrentPage = item.href === pathname;
          const label =
            'translationKey' in item
              ? t(item.translationKey)
              : item.label;

          return (
            <Fragment key={item.href}>
              <li aria-hidden="true" className="shrink-0">
                <ChevronRight className="h-3.5 w-3.5" />
              </li>
              <li className="min-w-0">
                {isCurrentPage ? (
                  <span
                    aria-current="page"
                    className="text-foreground block truncate font-medium"
                  >
                    {label}
                  </span>
                ) : inert ? (
                  <span className="block truncate">{label}</span>
                ) : (
                  <Link
                    href={item.href}
                    className="hover:text-foreground block truncate transition-colors"
                  >
                    {label}
                  </Link>
                )}
              </li>
            </Fragment>
          );
        })}
      </ol>
    </nav>
  );
};
