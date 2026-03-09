'use client'

import { useEffect, useRef } from 'react'

import { useChat } from '@ai-sdk/react'
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Package,
  RotateCcw,
  Sparkles,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import {
  Button,
  Dialog,
  DialogPopup,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { cn } from '@louez/utils'

import { ChatInput } from './chat-input'
import { ChatMessages } from './chat-messages'

const SUGGESTION_ICONS = [CalendarDays, BarChart3, Package, Users] as const

/** Error codes returned by the API route */
const RATE_LIMIT_CODES = new Set([
  'rate_limit:minute',
  'rate_limit:hour',
  'rate_limit:day',
])

type ChatModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChatModal({ open, onOpenChange }: ChatModalProps) {
  const t = useTranslations('dashboard.aiChat')
  const scrollRef = useRef<HTMLDivElement>(null)

  const { messages, sendMessage, status, setMessages, error, clearError } =
    useChat()

  const isLoading = status === 'submitted' || status === 'streaming'

  // Parse error code from the SDK error message
  const errorCode = error?.message?.trim() ?? ''
  const isUpgradeRequired = errorCode === 'upgrade_required'
  const isRateLimited = RATE_LIMIT_CODES.has(errorCode)
  const hasError = !!error

  // Resolve translated error message
  const errorMessage = hasError
    ? isUpgradeRequired
      ? t('limits.upgradeRequired')
      : isRateLimited
        ? t(`limits.${errorCode.replace(':', '_')}` as Parameters<typeof t>[0])
        : t('error')
    : null

  // Auto-scroll to bottom on new messages and while streaming
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  const handleReset = () => {
    setMessages([])
    clearError()
  }

  const handleSend = (text: string) => {
    if (!text.trim() || isLoading) return
    clearError()
    sendMessage({ text })
  }

  const suggestions = [
    { key: 'reservations', prompt: t('suggestions.reservations') },
    { key: 'stats', prompt: t('suggestions.stats') },
    { key: 'products', prompt: t('suggestions.products') },
    { key: 'customers', prompt: t('suggestions.customers') },
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        showCloseButton
        bottomStickOnMobile
        className={cn(
          'dashboard flex h-[min(80vh,720px)] w-full max-w-2xl flex-col overflow-hidden',
          'border-primary/15',
        )}
      >
        {/* Primary accent line */}
        <div className="h-[2px] shrink-0 bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <div>
              <DialogTitle className="text-sm font-medium leading-none">
                {t('title')}
              </DialogTitle>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t('subtitle')}
              </p>
            </div>
          </div>
          {messages.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      className="mr-8 h-7 w-7 text-muted-foreground hover:text-foreground"
                      onClick={handleReset}
                      aria-label={t('newConversation')}
                    />
                  }
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent>{t('newConversation')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Messages area */}
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-y-auto scroll-smooth"
        >
          {/* Animated gradient mesh background — only when empty */}
          {messages.length === 0 && (
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="ai-mesh-orb ai-mesh-orb--1" />
              <div className="ai-mesh-orb ai-mesh-orb--2" />
              <div className="ai-mesh-orb ai-mesh-orb--3" />
            </div>
          )}

          <div className="relative px-5 py-4" style={{ minHeight: '100%' }}>
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4" style={{ minHeight: 'calc(100% - 2rem)' }}>
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                  <Sparkles className="h-6 w-6 text-primary" />
                </div>
                <p className="text-foreground mb-1 text-base font-medium">
                  {t('emptyState')}
                </p>
                <p className="text-muted-foreground mb-8 text-xs">
                  {t('emptyStateHint')}
                </p>
                <div className="grid w-full max-w-md grid-cols-2 gap-2.5">
                  {suggestions.map((suggestion, i) => {
                    const Icon = SUGGESTION_ICONS[i]
                    return (
                      <button
                        key={suggestion.key}
                        type="button"
                        onClick={() => handleSend(suggestion.prompt)}
                        className={cn(
                          'group flex items-start gap-2.5 rounded-xl border border-border/60 bg-background/60 p-3 text-left text-[13px] backdrop-blur-sm',
                          'text-muted-foreground transition-all duration-200',
                          'hover:border-primary/30 hover:bg-background/80 hover:text-foreground',
                          'hover:shadow-[0_2px_8px_-2px] hover:shadow-primary/10',
                        )}
                      >
                        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/8 transition-colors group-hover:bg-primary/15">
                          <Icon className="h-3 w-3 text-primary/70 transition-colors group-hover:text-primary" />
                        </div>
                        <span className="leading-snug">{suggestion.prompt}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <ChatMessages messages={messages} isLoading={isLoading} />
            )}
          </div>
        </div>

        {/* Error / rate limit banner */}
        {errorMessage && (
          <div
            className={cn(
              'mx-4 mb-2 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs',
              isUpgradeRequired || isRateLimited
                ? 'border border-primary/20 bg-primary/5 text-foreground'
                : 'border border-destructive/20 bg-destructive/5 text-destructive',
            )}
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="flex-1">{errorMessage}</span>
            {(isUpgradeRequired || isRateLimited) && (
              <Link
                href="/dashboard/subscription"
                onClick={() => onOpenChange(false)}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {t('limits.upgrade')}
                <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}

        {/* Input */}
        <ChatInput onSend={handleSend} isLoading={isLoading} />
      </DialogPopup>
    </Dialog>
  )
}
