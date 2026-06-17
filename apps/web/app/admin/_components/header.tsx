'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { authClient } from '@louez/auth/client'
import { ArrowLeft, LineChart, LogOut, Shield } from 'lucide-react'

import { Button } from '@louez/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@louez/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@louez/ui'
import { cn } from '@louez/utils'
import { ThemeToggle } from '@/components/dashboard/theme-toggle'
import { LanguageSwitcher } from '@/components/ui/language-switcher'

interface AdminHeaderProps {
  userEmail: string
  userImage?: string | null
}

export function AdminHeader({ userEmail, userImage }: AdminHeaderProps) {
  const t = useTranslations('platformAdmin')
  const tAuth = useTranslations('auth')
  const tSettings = useTranslations('dashboard.settings.accountSettings')
  const pathname = usePathname()
  const initials = userEmail.slice(0, 2).toUpperCase()

  const navItems = [
    { href: '/admin/finance', label: t('nav.finance'), icon: LineChart },
  ]

  return (
    <header className="bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Left: brand + section nav */}
        <div className="flex items-center gap-6">
          <Link href="/admin" className="flex items-center gap-2">
            <Shield className="text-primary h-5 w-5" />
            <span className="text-sm font-semibold">{t('title')}</span>
          </Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Right: back to dashboard, theme, language, user menu */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            render={<Link href="/dashboard" />}
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{t('backToDashboard')}</span>
          </Button>

          <ThemeToggle />
          <LanguageSwitcher variant="compact" />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="icon" className="rounded-full" />
              }
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={userImage || undefined} />
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-medium">{userEmail}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                render={<Link href="/dashboard/account" className="cursor-pointer" />}
              >
                {tSettings('title')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() =>
                  authClient.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        window.location.href = '/login'
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
        </div>
      </div>
    </header>
  )
}
