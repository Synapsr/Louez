'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import {
  Package,
  CalendarDays,
  Copy,
  Share2,
  Check,
  Globe,
  ExternalLink,
  Sparkles,
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
    <Card className={cn('quick-actions-card stat-card', className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{t('quickActions.title')}</CardTitle>
          {storeState === 'virgin' && (
            <Sparkles className="h-4 w-4 text-amber-500" />
          )}
        </div>
        <CardDescription>{t('quickActions.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {actions.map((action) => (
          <Link
            key={action.key}
            href={action.href}
            className={cn(
              'quick-action-card flex items-center gap-3 rounded-xl border p-3.5',
              action.primary
                ? 'quick-action-primary border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 hover:border-primary/30'
                : 'hover:border-muted-foreground/20 hover:bg-muted/50'
            )}
          >
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105',
                action.primary
                  ? 'bg-primary/15'
                  : 'bg-muted'
              )}
            >
              <action.icon
                className={cn(
                  'h-5 w-5',
                  action.primary ? 'text-primary' : 'text-muted-foreground'
                )}
              />
            </div>
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
    <Card className={cn('stat-card overflow-hidden', className)}>
      {/* Header with gradient background */}
      <CardHeader className="storefront-header pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">{t('storefront.title')}</CardTitle>
            <CardDescription>{t('storefront.description')}</CardDescription>
          </div>
          {/* Online status indicator */}
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 dark:bg-emerald-900/30">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {t('storefront.online')}
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* URL Display with icon */}
        <div className="group relative overflow-hidden rounded-xl border bg-gradient-to-br from-muted/40 via-muted/20 to-transparent p-4 transition-all hover:border-primary/20 hover:shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Globe className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">
                {storeSlug}.{domain}
              </p>
              <p className="text-xs text-muted-foreground">
                {t('storefront.publicUrl')}
              </p>
            </div>
            <a
              href={storeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground transition-all hover:border-primary/30 hover:bg-primary/5 hover:text-primary"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'flex-1 transition-all',
              copied
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
                : 'hover:border-primary/30 hover:bg-primary/5'
            )}
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
          <Button
            variant="outline"
            size="sm"
            className="flex-1 transition-all hover:border-primary/30 hover:bg-primary/5"
            onClick={handleShare}
          >
            <Share2 className="mr-2 h-4 w-4" />
            {t('storefront.share')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
