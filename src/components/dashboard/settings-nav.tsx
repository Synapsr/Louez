'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Store, Palette, Clock, FileText, CreditCard, Percent, Wallet, Star, Bell } from 'lucide-react'
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
    href: '/dashboard/settings/taxes',
    icon: Percent,
    labelKey: 'taxes.title',
  },
  {
    href: '/dashboard/settings/payments',
    icon: Wallet,
    labelKey: 'payments.title',
  },
  {
    href: '/dashboard/settings/review-booster',
    icon: Star,
    labelKey: 'reviewBooster.title',
  },
  {
    href: '/dashboard/settings/notifications',
    icon: Bell,
    labelKey: 'notifications.title',
  },
  {
    href: '/dashboard/subscription',
    icon: CreditCard,
    labelKey: 'subscription.label',
  },
]

export function SettingsNav() {
  const pathname = usePathname()
  const router = useRouter()
  const t = useTranslations('dashboard.settings')

  const isActive = (href: string) => {
    if (href === '/dashboard/settings') {
      return pathname === '/dashboard/settings'
    }
    return pathname.startsWith(href)
  }

  const currentItem = settingsNavItems.find((item) => isActive(item.href))

  return (
    <aside>
      {/* Mobile / tablet: dropdown */}
      <div className="xl:hidden">
        <select
          value={currentItem?.href || '/dashboard/settings'}
          onChange={(e) => router.push(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none"
        >
          {settingsNavItems.map((item) => (
            <option key={item.href} value={item.href}>
              {t(item.labelKey)}
            </option>
          ))}
        </select>
      </div>

      {/* Desktop: vertical sidebar */}
      <nav className="hidden xl:flex xl:flex-col gap-0.5 xl:sticky xl:top-6">
        {settingsNavItems.map((item) => {
          const Icon = item.icon
          const active = isActive(item.href)

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
