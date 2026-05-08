'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import Gleap from 'gleap';
import { useTranslations } from 'next-intl';

import { authClient } from '@louez/auth/client';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Logo,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  Sidebar as UISidebar,
} from '@louez/ui';
import {
  AnalyticsIcon,
  CalendarDaysIcon,
  CalendarIcon,
  CreditCardIcon,
  CrownIcon,
  ExternalLinkIcon,
  GiftIcon,
  HomeIcon,
  LifeBuoyIcon,
  LogOutIcon,
  PackageIcon,
  SettingsIcon,
  SparklesIcon,
  UsersIcon,
} from '@louez/ui/icons';

import { StoreSwitcher } from '@/components/dashboard/store-switcher';
import { ThemeMenuSub } from '@/components/dashboard/theme-toggle';
import { LanguageMenuSub } from '@/components/ui/language-switcher';

import { cn } from '@/lib/utils';

import { env } from '@/env';

interface StoreWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: 'owner' | 'member' | 'platform_admin';
}

interface DashboardSidebarProps {
  stores: StoreWithRole[];
  currentStoreId: string;
  storeSlug?: string;
  userEmail: string;
  userImage?: string | null;
  planSlug?: string;
}

const mainNavigation = [
  { key: 'home', href: '/dashboard', icon: HomeIcon },
  { key: 'calendar', href: '/dashboard/calendar', icon: CalendarDaysIcon },
  { key: 'reservations', href: '/dashboard/reservations', icon: CalendarIcon },
  { key: 'customers', href: '/dashboard/customers', icon: UsersIcon },
];

const catalogNavigation = [
  { key: 'products', href: '/dashboard/products', icon: PackageIcon },
];

const analyticsNavigation = [
  { key: 'analytics', href: '/dashboard/analytics', icon: AnalyticsIcon },
];

const managementNavigation = [
  { key: 'team', href: '/dashboard/team', icon: UsersIcon },
  { key: 'referrals', href: '/dashboard/referrals', icon: GiftIcon },
  {
    key: 'subscription',
    href: '/dashboard/subscription',
    icon: CreditCardIcon,
  },
  { key: 'settings', href: '/dashboard/settings', icon: SettingsIcon },
];

const navigationSections = [
  { items: mainNavigation },
  { labelKey: 'catalog', items: catalogNavigation },
  { labelKey: 'analytics', items: analyticsNavigation },
  { labelKey: 'manage', items: managementNavigation },
] satisfies {
  labelKey?: string;
  items: typeof mainNavigation;
}[];

interface NavigationItem {
  key: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

const isNavigationItemActive = (pathname: string, href: string) => {
  if (href === '/dashboard') {
    return pathname === '/dashboard';
  }

  return pathname === href || pathname.startsWith(`${href}/`);
};

const DashboardNavItem = ({
  item,
  pathname,
}: {
  item: NavigationItem;
  pathname: string;
}) => {
  const t = useTranslations('dashboard.navigation');
  const active = isNavigationItemActive(pathname, item.href);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        render={<Link href={item.href} />}
        isActive={active}
        tooltip={t(item.key)}
      >
        <item.icon />
        <span>{t(item.key)}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

const DashboardNavSection = ({
  items,
  labelKey,
  pathname,
}: {
  items: NavigationItem[];
  labelKey?: string;
  pathname: string;
}) => {
  const t = useTranslations('dashboard.sidebar');

  return (
    <SidebarGroup>
      {labelKey && <SidebarGroupLabel>{t(labelKey)}</SidebarGroupLabel>}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <DashboardNavItem key={item.href} item={item} pathname={pathname} />
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

const StoreHeader = ({
  stores,
  currentStoreId,
  storeSlug,
  planSlug,
}: {
  stores: StoreWithRole[];
  currentStoreId: string;
  storeSlug?: string;
  planSlug?: string;
}) => {
  const t = useTranslations('dashboard.sidebar');
  return (
    <SidebarHeader className="border-sidebar-border gap-3 border-b px-0">
      <div className="flex min-w-0 items-center justify-between gap-2 group-data-[collapsible=icon]:flex-col group-data-[state=expanded]:pl-4">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
            <Logo className="h-5 w-auto shrink-0 group-data-[collapsible=icon]:hidden" />
            <Image
              src={'/favicon.svg'}
              width={32}
              height={32}
              alt="Logo"
              className="hidden size-8 shrink-0 group-data-[collapsible=icon]:block"
            />
          </Link>
          <PlanBadge planSlug={planSlug} />
        </div>

        {storeSlug && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Link
                  href={`https://${storeSlug}.${env.NEXT_PUBLIC_APP_DOMAIN}`}
                  target="_blank"
                  className="text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex size-8 shrink-0 items-center justify-center rounded-md transition-colors group-data-[collapsible=icon]:hidden"
                />
              }
            >
              <ExternalLinkIcon className="h-4 w-4" />
              <span className="sr-only">{t('viewStore')}</span>
            </TooltipTrigger>
            <TooltipContent side="right">{t('viewStore')}</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="mx-auto w-fit group-data-[state=expanded]:w-full">
        <StoreSwitcher stores={stores} currentStoreId={currentStoreId} />
      </div>
    </SidebarHeader>
  );
};

const UserMenu = ({
  userEmail,
  userImage,
}: {
  userEmail: string;
  userImage?: string | null;
}) => {
  const t = useTranslations('dashboard.settings.accountSettings');
  const tAuth = useTranslations('auth');
  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="hover:bg-sidebar-accent h-12 w-full justify-start gap-3 px-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:px-0"
          />
        }
      >
        <Avatar className="size-8 shrink-0">
          <AvatarImage src={userImage || undefined} />
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-left text-sm font-medium group-data-[collapsible=icon]:hidden">
          {userEmail}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <ThemeMenuSub />
        <LanguageMenuSub />
        <DropdownMenuItem render={<Link href="/dashboard/account" />}>
          {t('title')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  window.location.href = '/login';
                },
              },
            })
          }
          className="text-destructive cursor-pointer"
        >
          <LogOutIcon className="mr-2 h-4 w-4" />
          {tAuth('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const HelpButton = () => {
  const t = useTranslations('dashboard.sidebar');

  return (
    <Button
      variant="ghost"
      className="hover:bg-sidebar-accent h-auto w-full justify-start gap-3 px-2 py-2 text-left group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-0"
      onClick={() => Gleap.open()}
    >
      <LifeBuoyIcon className="text-sidebar-foreground/70 h-4 w-4 shrink-0" />
      <span className="min-w-0 group-data-[collapsible=icon]:hidden">
        <span className="block text-sm leading-none font-medium">
          {t('help')}
        </span>
        {/* <span className="text-muted-foreground mt-1 block truncate text-xs">
          {t('feedback')}
        </span> */}
      </span>
    </Button>
  );
};

export const DashboardSidebar = ({
  stores,
  currentStoreId,
  storeSlug,
  userEmail,
  userImage,
  planSlug,
}: DashboardSidebarProps) => {
  const pathname = usePathname();

  return (
    <TooltipProvider>
      <UISidebar variant="inset" collapsible="icon">
        <StoreHeader
          stores={stores}
          currentStoreId={currentStoreId}
          storeSlug={storeSlug}
          planSlug={planSlug}
        />
        <SidebarContent>
          {navigationSections.map((section, index) => (
            <div key={section.labelKey || 'main'}>
              {index > 0 && <SidebarSeparator />}
              <DashboardNavSection
                items={section.items}
                labelKey={section.labelKey}
                pathname={pathname}
              />
            </div>
          ))}
        </SidebarContent>
        <SidebarFooter className="border-sidebar-border border-t">
          <div>
            <HelpButton />
          </div>
          <UserMenu userEmail={userEmail} userImage={userImage} />
        </SidebarFooter>
        {/* <SidebarRail /> */}
      </UISidebar>
    </TooltipProvider>
  );
};

function PlanBadge({ planSlug }: { planSlug?: string }) {
  const plan = planSlug || 'start';

  const planConfig: Record<
    string,
    { label: string; className: string; icon: React.ReactNode }
  > = {
    start: {
      label: 'Start',
      className: 'bg-muted text-muted-foreground hover:bg-muted/80',
      icon: null,
    },
    pro: {
      label: 'Pro',
      className: 'bg-primary/10 text-primary hover:bg-primary/20',
      icon: <SparklesIcon className="h-3 w-3" />,
    },
    ultra: {
      label: 'Ultra',
      className:
        'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20',
      icon: <CrownIcon className="h-3 w-3" />,
    },
  };

  const config = planConfig[plan] || planConfig.start;

  return (
    <Link
      href="/dashboard/subscription"
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors group-data-[collapsible=icon]:hidden',
        config.className,
      )}
    >
      {config.icon}
      {config.label}
    </Link>
  );
}
