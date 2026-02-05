'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { env } from '@/env'
import {
  Package,
  CalendarDays,
  Copy,
  Share2,
  Check,
  Globe,
  ExternalLink,
  Sparkles,
  ArrowRight,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '@louez/utils'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { ShareModal } from './share-modal'

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
              'list-item-hover border pr-12',
              action.primary
                ? 'border-primary/20 bg-gradient-to-r from-primary/5 to-primary/10 hover:border-primary/30 hover:from-primary/8 hover:to-primary/15'
                : 'border-transparent hover:border-muted-foreground/10 hover:bg-muted/50'
            )}
          >
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
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
            <div className={cn(
              'reveal-action flex h-8 w-8 items-center justify-center rounded-lg',
              action.primary
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            )}>
              <ArrowRight className="h-4 w-4" />
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
  const [shareModalOpen, setShareModalOpen] = useState(false)

  const domain = env.NEXT_PUBLIC_APP_DOMAIN
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

  return (
    <>
      <Card className={cn('stat-card overflow-hidden !pt-0', className)}>
        {/* Header with gradient background - custom div instead of CardHeader for full control */}
        <div className="storefront-header-wrapper">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold leading-none">{t('storefront.title')}</h3>
              <p className="text-sm text-muted-foreground">{t('storefront.description')}</p>
            </div>
            {/* Online status indicator */}
            <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 dark:bg-emerald-900/30">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                {t('storefront.online')}
              </span>
            </div>
          </div>
        </div>

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

          {/* Action buttons - Cleaner design */}
          <div className="flex gap-2">
            <button
              className={cn(
                'action-btn flex-1',
                copied && 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400'
              )}
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? t('storefront.copied') : t('storefront.copy')}
            </button>
            <button
              className="action-btn action-btn--primary flex-1"
              onClick={() => setShareModalOpen(true)}
            >
              <Share2 className="h-4 w-4" />
              {t('storefront.share')}
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Share Modal */}
      <ShareModal
        open={shareModalOpen}
        onOpenChange={setShareModalOpen}
        storeUrl={storeUrl}
      />
    </>
  )
}
