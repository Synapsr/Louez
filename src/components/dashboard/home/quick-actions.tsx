'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  Package,
  CalendarDays,
  Copy,
  Share2,
  Check,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

// Type defined inline to avoid server-only module import
type StoreState = 'virgin' | 'building' | 'starting' | 'active' | 'established'

interface QuickActionsProps {
  storeState: StoreState
  className?: string
}

export function QuickActions({ storeState, className }: QuickActionsProps) {
  const t = useTranslations('dashboard.home')

  // Determine which actions to show based on store state
  const getActions = () => {
    if (storeState === 'virgin') {
      return [
        {
          key: 'addProduct',
          icon: Package,
          href: '/dashboard/products/new',
          primary: true,
        },
      ]
    }

    if (storeState === 'building') {
      return [
        {
          key: 'addProduct',
          icon: Package,
          href: '/dashboard/products/new',
          primary: false,
        },
        {
          key: 'addReservation',
          icon: CalendarDays,
          href: '/dashboard/reservations/new',
          primary: true,
        },
      ]
    }

    return [
      {
        key: 'addProduct',
        icon: Package,
        href: '/dashboard/products/new',
        primary: false,
      },
      {
        key: 'addReservation',
        icon: CalendarDays,
        href: '/dashboard/reservations/new',
        primary: false,
      },
    ]
  }

  const actions = getActions()

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('quickActions.title')}</CardTitle>
        <CardDescription>{t('quickActions.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {actions.map((action) => (
          <Link
            key={action.key}
            href={action.href}
            className={cn(
              'flex items-center gap-3 rounded-lg border p-3 transition-colors',
              action.primary
                ? 'border-primary/20 bg-primary/5 hover:bg-primary/10'
                : 'hover:bg-muted'
            )}
          >
            <action.icon
              className={cn(
                'h-5 w-5',
                action.primary ? 'text-primary' : 'text-muted-foreground'
              )}
            />
            <div className="min-w-0 flex-1">
              <p className={cn('font-medium', action.primary && 'text-primary')}>
                {t(`quickActions.${action.key}.title`)}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {t(`quickActions.${action.key}.description`)}
              </p>
            </div>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

interface StorefrontWidgetProps {
  storeSlug: string
  className?: string
}

export function StorefrontWidget({ storeSlug, className }: StorefrontWidgetProps) {
  const t = useTranslations('dashboard.home')
  const [copied, setCopied] = useState(false)

  const domain = process.env.NEXT_PUBLIC_APP_DOMAIN || 'localhost'
  const storeUrl = `https://${storeSlug}.${domain}`

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(storeUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: t('storefront.shareTitle'),
          url: storeUrl,
        })
      } catch (err) {
        // User cancelled or error
        console.error('Share failed:', err)
      }
    } else {
      handleCopy()
    }
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{t('storefront.title')}</CardTitle>
        <CardDescription>{t('storefront.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {storeSlug}.{domain}
          </span>
          <a
            href={storeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            {t('storefront.visit')}
          </a>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={handleCopy}
          >
            {copied ? (
              <>
                <Check className="mr-2 h-4 w-4" />
                {t('storefront.copied')}
              </>
            ) : (
              <>
                <Copy className="mr-2 h-4 w-4" />
                {t('storefront.copy')}
              </>
            )}
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={handleShare}>
            <Share2 className="mr-2 h-4 w-4" />
            {t('storefront.share')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
