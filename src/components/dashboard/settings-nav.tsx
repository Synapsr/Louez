'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Store, Palette, Clock, Mail, FileText, CreditCard } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SettingsNavItem {
  href: string
  icon: React.ElementType
  labelKey: string
}

const settingsNavItems: SettingsNavItem[] = [
  {
    href: '/dashboard/settings',
    icon: Store,
    labelKey: 'store',
  },
  {
    href: '/dashboard/settings/hours',
    icon: Clock,
    labelKey: 'hours',
  },
  {
    href: '/dashboard/settings/appearance',
    icon: Palette,
    labelKey: 'appearance',
  },
  {
    href: '/dashboard/settings/legal',
    icon: FileText,
    labelKey: 'legal',
  },
  {
    href: '/dashboard/settings/emails',
    icon: Mail,
    labelKey: 'emails',
  },
  {
    href: '/dashboard/settings/subscription',
    icon: CreditCard,
    labelKey: 'subscription.label',
  },
]

export function SettingsNav() {
  const pathname = usePathname()
  const t = useTranslations('dashboard.settings')

  const isActive = (href: string) => {
    if (href === '/dashboard/settings') {
      return pathname === '/dashboard/settings'
    }
    return pathname.startsWith(href)
  }

  return (
    <nav className="flex flex-wrap gap-2">
      {settingsNavItems.map((item) => {
        const Icon = item.icon
        const active = isActive(item.href)

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {t(item.labelKey)}
          </Link>
        )
      })}
    </nav>
  )
}
