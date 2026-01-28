'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { signOut } from 'next-auth/react'
import { LogOut, Store, ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Logo } from '@/components/ui/logo'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ThemeToggle } from '@/components/dashboard/theme-toggle'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface StoreWithRole {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  role: 'owner' | 'member' | 'platform_admin'
}

interface MultiStoreHeaderProps {
  stores: StoreWithRole[]
  userEmail: string
  userImage?: string | null
}

function setCurrentStoreCookie(storeId: string) {
  document.cookie = `currentStoreId=${storeId}; path=/; max-age=31536000`
}

export function MultiStoreHeader({ stores, userEmail, userImage }: MultiStoreHeaderProps) {
  const t = useTranslations('dashboard.multiStore')
  const tAuth = useTranslations('auth')
  const tSettings = useTranslations('dashboard.settings.accountSettings')
  const router = useRouter()
  const initials = userEmail.slice(0, 2).toUpperCase()

  const handleStoreSelect = (storeId: string) => {
    setCurrentStoreCookie(storeId)
    router.push('/dashboard')
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <div className="flex items-center gap-6">
          <Link href="/multi-store" className="flex items-center gap-2">
            <Logo className="h-6 w-auto" />
          </Link>
          <span className="hidden text-sm font-medium text-muted-foreground sm:inline">
            {t('title')}
          </span>
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Quick store access */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <Store className="h-4 w-4" />
                <span className="hidden sm:inline">{t('goToAStore')}</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {stores.map((store) => (
                <DropdownMenuItem
                  key={store.id}
                  onClick={() => handleStoreSelect(store.id)}
                  className="cursor-pointer"
                >
                  <Avatar className="mr-2 h-6 w-6">
                    <AvatarImage src={store.logoUrl || undefined} alt={store.name} />
                    <AvatarFallback className="text-xs">
                      {store.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{store.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Theme toggle */}
          <ThemeToggle />

          {/* Language */}
          <LanguageSwitcher variant="compact" />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={userImage || undefined} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium truncate">{userEmail}</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/dashboard/account" className="cursor-pointer">
                  {tSettings('title')}
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
        </div>
      </div>
    </header>
  )
}
