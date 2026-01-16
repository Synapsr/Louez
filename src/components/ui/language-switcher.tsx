'use client'

import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { useState, useEffect } from 'react'
import { locales, localeNames, localeFlags, Locale } from '@/i18n/config'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Globe } from 'lucide-react'

interface LanguageSwitcherProps {
  variant?: 'default' | 'compact' | 'minimal'
  className?: string
}

function setLocaleCookie(locale: Locale) {
  document.cookie = `NEXT_LOCALE=${locale};path=/;max-age=31536000;samesite=lax`
}

export function LanguageSwitcher({ variant = 'default', className }: LanguageSwitcherProps) {
  const locale = useLocale() as Locale
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleLocaleChange = (newLocale: Locale) => {
    if (newLocale === locale) return
    setLocaleCookie(newLocale)
    router.refresh()
  }

  if (variant === 'minimal') {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        {locales.map((loc) => (
          <button
            key={loc}
            onClick={() => handleLocaleChange(loc)}
            className={cn(
              'px-2 py-1 text-sm rounded transition-colors',
              locale === loc
                ? 'bg-primary/10 text-primary font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
          >
            {localeFlags[loc]}
          </button>
        ))}
      </div>
    )
  }

  if (variant === 'compact') {
    if (!mounted) {
      return (
        <Button variant="ghost" size="sm" className={cn('gap-2', className)}>
          <span className="text-base">{localeFlags[locale]}</span>
          <span className="text-xs uppercase">{locale}</span>
        </Button>
      )
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className={cn('gap-2', className)}>
            <span className="text-base">{localeFlags[locale]}</span>
            <span className="text-xs uppercase">{locale}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {locales.map((loc) => (
            <DropdownMenuItem
              key={loc}
              onClick={() => handleLocaleChange(loc)}
              className={cn(
                'gap-2 cursor-pointer',
                locale === loc && 'bg-accent'
              )}
            >
              <span className="text-base">{localeFlags[loc]}</span>
              <span>{localeNames[loc]}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  if (!mounted) {
    return (
      <Button variant="outline" size="sm" className={cn('gap-2 w-full justify-start', className)}>
        <Globe className="h-4 w-4" />
        <span className="text-base">{localeFlags[locale]}</span>
        <span className="flex-1 text-left">{localeNames[locale]}</span>
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={cn('gap-2 w-full justify-start', className)}>
          <Globe className="h-4 w-4" />
          <span className="text-base">{localeFlags[locale]}</span>
          <span className="flex-1 text-left">{localeNames[locale]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
        {locales.map((loc) => (
          <DropdownMenuItem
            key={loc}
            onClick={() => handleLocaleChange(loc)}
            className={cn(
              'gap-2 cursor-pointer',
              locale === loc && 'bg-accent'
            )}
          >
            <span className="text-base">{localeFlags[loc]}</span>
            <span>{localeNames[loc]}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
