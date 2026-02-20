'use client';

import { useState } from 'react';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import {
  BarChart3,
  Calendar,
  CalendarDays,
  ChevronRight,
  CreditCard,
  Crown,
  ExternalLink,
  Gift,
  Home,
  LogOut,
  Menu,
  Package,
  Plus,
  Settings,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { authClient } from '@louez/auth/client';
import { Button } from '@louez/ui';
import { Logo, LogoIcon } from '@louez/ui';
import { Avatar, AvatarFallback, AvatarImage } from '@louez/ui';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@louez/ui';
import { Sheet, SheetContent, SheetTrigger } from '@louez/ui';
import { Separator } from '@louez/ui';
import { cn } from '@louez/utils';

import { PendingReservationsAlert } from '@/components/dashboard/pending-reservations-alert';
import { StoreSwitcher } from '@/components/dashboard/store-switcher';
import { ThemeToggle } from '@/components/dashboard/theme-toggle';
import { LanguageSwitcher } from '@/components/ui/language-switcher';

import { env } from '@/env';

interface StoreWithRole {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  role: 'owner' | 'member' | 'platform_admin';
}

interface SidebarProps {
  stores: StoreWithRole[];
  currentStoreId: string;
  storeSlug?: string;
  userEmail: string;
  userImage?: string | null;
  planSlug?: string;
}

const mainNavigation = [
  { key: 'home', href: '/dashboard', icon: Home },
  { key: 'calendar', href: '/dashboard/calendar', icon: CalendarDays },
  { key: 'reservations', href: '/dashboard/reservations', icon: Calendar },
  { key: 'customers', href: '/dashboard/customers', icon: Users },
];

const catalogNavigation = [
  { key: 'products', href: '/dashboard/products', icon: Package },
];

const analyticsNavigation = [
  { key: 'analytics', href: '/dashboard/analytics', icon: BarChart3 },
];

const managementNavigation = [
  { key: 'team', href: '/dashboard/team', icon: Users },
  { key: 'referrals', href: '/dashboard/referrals', icon: Gift },
  { key: 'subscription', href: '/dashboard/subscription', icon: CreditCard },
  { key: 'settings', href: '/dashboard/settings', icon: Settings },
];

interface NavItemProps {
  item: {
    key: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
  };
  pathname: string;
  onNavigate?: () => void;
  t: (key: string) => string;
}

function NavItem({ item, pathname, onNavigate, t }: NavItemProps) {
  const isActive =
    pathname === item.href ||
    (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
  const isExactDashboard =
    item.href === '/dashboard' && pathname === '/dashboard';
  const active = isExactDashboard || isActive;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      <item.icon
        className={cn(
          'h-[18px] w-[18px] shrink-0 transition-transform duration-200',
          !active && 'group-hover:scale-110',
        )}
      />
      <span className="truncate">{t(item.key)}</span>
      {active && <ChevronRight className="ml-auto h-4 w-4 opacity-70" />}
    </Link>
  );
}

function NavSection({
  items,
  pathname,
  onNavigate,
  t,
  label,
}: {
  items: typeof mainNavigation;
  pathname: string;
  onNavigate?: () => void;
  t: (key: string) => string;
  label?: string;
}) {
  return (
    <div className="space-y-1">
      {label && (
        <p className="text-muted-foreground/70 mb-2 px-3 text-[11px] font-semibold tracking-wider uppercase">
          {label}
        </p>
      )}
      {items.map((item) => (
        <NavItem
          key={item.key}
          item={item}
          pathname={pathname}
          onNavigate={onNavigate}
          t={t}
        />
      ))}
    </div>
  );
}

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const t = useTranslations('dashboard.navigation');
  const tNav = useTranslations('dashboard.sidebar');

  return (
    <nav className="flex-1 space-y-3 px-3 py-4">
      <NavSection
        items={mainNavigation}
        pathname={pathname}
        onNavigate={onNavigate}
        t={t}
      />
      <Separator className="my-1 opacity-40" />
      <NavSection
        items={catalogNavigation}
        pathname={pathname}
        onNavigate={onNavigate}
        t={t}
        label={tNav('catalog')}
      />
      <Separator className="my-1 opacity-40" />
      <NavSection
        items={analyticsNavigation}
        pathname={pathname}
        onNavigate={onNavigate}
        t={t}
        label={tNav('analytics')}
      />
      <Separator className="my-1 opacity-40" />
      <NavSection
        items={managementNavigation}
        pathname={pathname}
        onNavigate={onNavigate}
        t={t}
        label={tNav('manage')}
      />
    </nav>
  );
}

function UserMenu({
  userEmail,
  userImage,
}: {
  userEmail: string;
  userImage?: string | null;
}) {
  const t = useTranslations('dashboard.settings.accountSettings');
  const tAuth = useTranslations('auth');
  const initials = userEmail.slice(0, 2).toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="hover:bg-accent/50 w-full justify-start gap-3 px-3 py-6 transition-colors duration-200"
          />
        }
      >
        <Avatar className="ring-border h-9 w-9 ring-2">
          <AvatarImage src={userImage || undefined} />
          <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-col items-start">
          <span className="truncate text-sm font-medium">{userEmail}</span>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          render={<Link href="/dashboard/account" className="cursor-pointer" />}
        >
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
          <LogOut className="mr-2 h-4 w-4" />
          {tAuth('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
      icon: <Sparkles className="h-3 w-3" />,
    },
    ultra: {
      label: 'Ultra',
      className:
        'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20',
      icon: <Crown className="h-3 w-3" />,
    },
  };

  const config = planConfig[plan] || planConfig.start;

  return (
    <Link
      href="/dashboard/subscription"
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
        config.className,
      )}
    >
      {config.icon}
      {config.label}
    </Link>
  );
}

function StoreHeader({
  stores,
  currentStoreId,
  storeSlug,
  planSlug,
}: {
  stores: StoreWithRole[];
  currentStoreId: string;
  storeSlug?: string;
  planSlug?: string;
}) {
  const t = useTranslations('dashboard.sidebar');

  return (
    <div className="space-y-3">
      {/* Louez Logo + Plan Badge */}
      <div className="flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <Link href="/dashboard" className="flex items-center">
            <Logo className="h-5 w-auto" />
          </Link>
          <PlanBadge planSlug={planSlug} />
        </div>
        {storeSlug && (
          <Link
            href={`https://${storeSlug}.${env.NEXT_PUBLIC_APP_DOMAIN}`}
            target="_blank"
            className="hover:bg-accent text-muted-foreground hover:text-foreground rounded-lg p-2 transition-colors"
            title={t('viewStore')}
          >
            <ExternalLink className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* Store Switcher */}
      <div className="px-2">
        <StoreSwitcher stores={stores} currentStoreId={currentStoreId} />
      </div>
    </div>
  );
}

function NewReservationLabel() {
  const t = useTranslations('dashboard.sidebar');
  return <>{t('newReservation')}</>;
}

export function Sidebar({
  stores,
  currentStoreId,
  storeSlug,
  userEmail,
  userImage,
  planSlug,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="hidden overscroll-y-none lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
      <div className="bg-card/50 flex grow flex-col overflow-y-auto overscroll-y-none border-r backdrop-blur-sm">
        {/* Store Header */}
        <div className="bg-card sticky top-0 z-10 border-b px-1 py-3">
          <StoreHeader
            stores={stores}
            currentStoreId={currentStoreId}
            storeSlug={storeSlug}
            planSlug={planSlug}
          />
        </div>

        {/* Navigation */}
        <NavLinks pathname={pathname} />

        {/* Bottom Section */}
        <div className="bg-card sticky bottom-0 border-t">
          {/* Pending Reservations Alert + New Reservation Button */}
          <div className="space-y-2 p-3">
            <PendingReservationsAlert />
            <Button
              render={<Link href="/dashboard/reservations/new" />}
              className="w-full"
            >
              <Plus className="mr-2 h-4 w-4" />
              <NewReservationLabel />
            </Button>
          </div>

          <Separator className="opacity-50" />

          {/* Theme/Language + User Menu */}
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageSwitcher variant="compact" />
            </div>
          </div>
          <div className="px-1 pb-2">
            <UserMenu userEmail={userEmail} userImage={userImage} />
          </div>
        </div>
      </div>
    </aside>
  );
}

export function MobileHeader({
  stores,
  currentStoreId,
  storeSlug,
  userEmail,
  userImage,
  planSlug,
}: SidebarProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const currentStore = stores.find((s) => s.id === currentStoreId);

  return (
    <header className="bg-card/80 sticky top-0 z-40 flex h-14 items-center justify-between border-b px-4 backdrop-blur-sm lg:hidden">
      <div className="flex items-center gap-3">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={<Button variant="ghost" size="icon" className="shrink-0" />}
          >
            <Menu className="h-5 w-5" />
            <span className="sr-only">Menu</span>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <div className="flex items-center gap-2">
                <Link
                  href="/dashboard"
                  className="flex items-center"
                  onClick={() => setOpen(false)}
                >
                  <Logo className="h-5 w-auto" />
                </Link>
                <PlanBadge planSlug={planSlug} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex h-[calc(100%-3.5rem)] flex-col">
              {/* Store Switcher */}
              <div className="border-b p-3">
                <StoreSwitcher
                  stores={stores}
                  currentStoreId={currentStoreId}
                />
              </div>
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
              <div className="mt-auto border-t">
                {/* Pending Reservations Alert + New Reservation Button */}
                <div className="space-y-2 p-3">
                  <PendingReservationsAlert onNavigate={() => setOpen(false)} />
                  <Button
                    render={<Link href="/dashboard/reservations/new" />}
                    className="w-full"
                    onClick={() => setOpen(false)}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    <NewReservationLabel />
                  </Button>
                </div>
                <Separator className="opacity-50" />
                {/* Theme/Language + User Menu */}
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <ThemeToggle />
                    <LanguageSwitcher variant="compact" />
                  </div>
                </div>
                <div className="px-1 pb-2">
                  <UserMenu userEmail={userEmail} userImage={userImage} />
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-w-0 items-center gap-2">
          <LogoIcon size={24} className="shrink-0" />
          <span className="truncate font-semibold">
            {currentStore?.name || 'Louez'}
          </span>
          <PlanBadge planSlug={planSlug} />
        </div>
      </div>

      {storeSlug && (
        <Link
          href={`https://${storeSlug}.${env.NEXT_PUBLIC_APP_DOMAIN}`}
          target="_blank"
          className="hover:bg-accent text-muted-foreground hover:text-foreground shrink-0 rounded-lg p-2 transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      )}
    </header>
  );
}
