'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { signOut } from 'next-auth/react'
import { env } from '@/env'
import {
  Home,
  Package,
  CalendarDays,
  Calendar,
  Users,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronRight,
  ExternalLink,
  CreditCard,
  Plus,
  Crown,
  Sparkles,
  Gift,
} from 'lucide-react'
import { useState } from 'react'

import { cn } from '@louez/utils'
import { Button } from '@louez/ui'
import { Logo, LogoIcon } from '@/components/ui/logo'
import { Avatar, AvatarFallback, AvatarImage } from '@louez/ui'
import { ThemeToggle } from '@/components/dashboard/theme-toggle'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { StoreSwitcher } from '@/components/dashboard/store-switcher'
import { PendingReservationsAlert } from '@/components/dashboard/pending-reservations-alert'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@louez/ui'
import { Sheet, SheetContent, SheetTrigger } from '@louez/ui'
import { Separator } from '@louez/ui'

interface StoreWithRole {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  role: 'owner' | 'member' | 'platform_admin'
}

interface SidebarProps {
  stores: StoreWithRole[]
  currentStoreId: string
  storeSlug?: string
  userEmail: string
  userImage?: string | null
  planSlug?: string
}

const mainNavigation = [
  { key: 'home', href: '/dashboard', icon: Home },
  { key: 'calendar', href: '/dashboard/calendar', icon: CalendarDays },
  { key: 'reservations', href: '/dashboard/reservations', icon: Calendar },
  { key: 'customers', href: '/dashboard/customers', icon: Users },
]

const catalogNavigation = [
  { key: 'products', href: '/dashboard/products', icon: Package },
]

const analyticsNavigation = [
  { key: 'analytics', href: '/dashboard/analytics', icon: BarChart3 },
]

const managementNavigation = [
  { key: 'team', href: '/dashboard/team', icon: Users },
  { key: 'referrals', href: '/dashboard/referrals', icon: Gift },
  { key: 'subscription', href: '/dashboard/subscription', icon: CreditCard },
  { key: 'settings', href: '/dashboard/settings', icon: Settings },
]

interface NavItemProps {
  item: { key: string; href: string; icon: React.ComponentType<{ className?: string }> }
  pathname: string
  onNavigate?: () => void
  t: (key: string) => string
}

function NavItem({ item, pathname, onNavigate, t }: NavItemProps) {
  const isActive = pathname === item.href ||
    (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`))
  const isExactDashboard = item.href === '/dashboard' && pathname === '/dashboard'
  const active = isExactDashboard || isActive

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200',
        active
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      <item.icon className={cn(
        'h-[18px] w-[18px] shrink-0 transition-transform duration-200',
        !active && 'group-hover:scale-110'
      )} />
      <span className="truncate">{t(item.key)}</span>
      {active && (
        <ChevronRight className="ml-auto h-4 w-4 opacity-70" />
      )}
    </Link>
  )
}

function NavSection({
  items,
  pathname,
  onNavigate,
  t,
  label
}: {
  items: typeof mainNavigation
  pathname: string
  onNavigate?: () => void
  t: (key: string) => string
  label?: string
}) {
  return (
    <div className="space-y-1">
      {label && (
        <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
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
  )
}

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const t = useTranslations('dashboard.navigation')
  const tNav = useTranslations('dashboard.sidebar')

  return (
    <nav className="flex-1 space-y-3 px-3 py-4">
      <NavSection items={mainNavigation} pathname={pathname} onNavigate={onNavigate} t={t} />
      <Separator className="opacity-40 my-1" />
      <NavSection
        items={catalogNavigation}
        pathname={pathname}
        onNavigate={onNavigate}
        t={t}
        label={tNav('catalog')}
      />
      <Separator className="opacity-40 my-1" />
      <NavSection
        items={analyticsNavigation}
        pathname={pathname}
        onNavigate={onNavigate}
        t={t}
        label={tNav('analytics')}
      />
      <Separator className="opacity-40 my-1" />
      <NavSection
        items={managementNavigation}
        pathname={pathname}
        onNavigate={onNavigate}
        t={t}
        label={tNav('manage')}
      />
    </nav>
  )
}

function UserMenu({
  userEmail,
  userImage,
}: {
  userEmail: string
  userImage?: string | null
}) {
  const t = useTranslations('dashboard.settings.accountSettings')
  const tAuth = useTranslations('auth')
  const initials = userEmail.slice(0, 2).toUpperCase()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 px-3 py-6 hover:bg-accent/50 transition-colors duration-200"
        >
          <Avatar className="h-9 w-9 ring-2 ring-border">
            <AvatarImage src={userImage || undefined} />
            <AvatarFallback className="bg-primary/10 text-primary text-sm font-medium">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col items-start min-w-0">
            <span className="truncate text-sm font-medium">{userEmail}</span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/dashboard/account" className="cursor-pointer">
            {t('title')}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="text-destructive cursor-pointer"
        >
          <LogOut className="h-4 w-4 mr-2" />
          {tAuth('logout')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PlanBadge({ planSlug }: { planSlug?: string }) {
  const plan = planSlug || 'start'

  const planConfig: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
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
      className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20',
      icon: <Crown className="h-3 w-3" />,
    },
  }

  const config = planConfig[plan] || planConfig.start

  return (
    <Link
      href="/dashboard/subscription"
      className={cn(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
        config.className
      )}
    >
      {config.icon}
      {config.label}
    </Link>
  )
}

function StoreHeader({
  stores,
  currentStoreId,
  storeSlug,
  planSlug,
}: {
  stores: StoreWithRole[]
  currentStoreId: string
  storeSlug?: string
  planSlug?: string
}) {
  const t = useTranslations('dashboard.sidebar')

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
            className="p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
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
  )
}

function NewReservationLabel() {
  const t = useTranslations('dashboard.sidebar')
  return <>{t('newReservation')}</>
}

export function Sidebar({ stores, currentStoreId, storeSlug, userEmail, userImage, planSlug }: SidebarProps) {
  const pathname = usePathname()

  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-64 lg:flex-col">
      <div className="flex grow flex-col overflow-y-auto border-r bg-card/50 backdrop-blur-sm">
        {/* Store Header */}
        <div className="sticky top-0 z-10 bg-card/80 backdrop-blur-sm border-b px-1 py-3">
          <StoreHeader stores={stores} currentStoreId={currentStoreId} storeSlug={storeSlug} planSlug={planSlug} />
        </div>

        {/* Navigation */}
        <NavLinks pathname={pathname} />

        {/* Bottom Section */}
        <div className="sticky bottom-0 bg-card/80 backdrop-blur-sm border-t">
          {/* Pending Reservations Alert + New Reservation Button */}
          <div className="p-3 space-y-2">
            <PendingReservationsAlert />
            <Button asChild className="w-full">
              <Link href="/dashboard/reservations/new">
                <Plus className="mr-2 h-4 w-4" />
                <NewReservationLabel />
              </Link>
            </Button>
          </div>
          <Separator className="opacity-50" />
          {/* Theme/Language + User Menu */}
          <div className="px-3 py-2 flex items-center justify-between">
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
  )
}

export function MobileHeader({ stores, currentStoreId, storeSlug, userEmail, userImage, planSlug }: SidebarProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const currentStore = stores.find((s) => s.id === currentStoreId)

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b bg-card/80 backdrop-blur-sm px-4 lg:hidden">
      <div className="flex items-center gap-3">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Menu</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-72 p-0">
            <div className="flex h-14 items-center justify-between border-b px-4">
              <div className="flex items-center gap-2">
                <Link href="/dashboard" className="flex items-center" onClick={() => setOpen(false)}>
                  <Logo className="h-5 w-auto" />
                </Link>
                <PlanBadge planSlug={planSlug} />
              </div>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex flex-col h-[calc(100%-3.5rem)]">
              {/* Store Switcher */}
              <div className="p-3 border-b">
                <StoreSwitcher stores={stores} currentStoreId={currentStoreId} />
              </div>
              <NavLinks pathname={pathname} onNavigate={() => setOpen(false)} />
              <div className="mt-auto border-t">
                {/* Pending Reservations Alert + New Reservation Button */}
                <div className="p-3 space-y-2">
                  <PendingReservationsAlert onNavigate={() => setOpen(false)} />
                  <Button asChild className="w-full" onClick={() => setOpen(false)}>
                    <Link href="/dashboard/reservations/new">
                      <Plus className="mr-2 h-4 w-4" />
                      <NewReservationLabel />
                    </Link>
                  </Button>
                </div>
                <Separator className="opacity-50" />
                {/* Theme/Language + User Menu */}
                <div className="px-3 py-2 flex items-center justify-between">
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

        <div className="flex items-center gap-2 min-w-0">
          <LogoIcon size={24} className="shrink-0" />
          <span className="font-semibold truncate">{currentStore?.name || 'Louez'}</span>
          <PlanBadge planSlug={planSlug} />
        </div>
      </div>

      {storeSlug && (
        <Link
          href={`https://${storeSlug}.${env.NEXT_PUBLIC_APP_DOMAIN}`}
          target="_blank"
          className="shrink-0 p-2 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="h-4 w-4" />
        </Link>
      )}
    </header>
  )
}
