'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { format, type Locale } from 'date-fns'
import { fr, enUS, de, es, it, nl, pl, pt } from 'date-fns/locale'
import {
  MessageSquare,
  CheckCircle2,
  XCircle,
  Phone,
  User,
  Clock,
  ArrowUpRight,
  AlertTriangle,
  Eye,
  CalendarDays,
  ChevronDown,
  Plus,
  Sparkles,
} from 'lucide-react'
import Link from 'next/link'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Progress } from '@louez/ui'
import { Button } from '@louez/ui'
import { Alert, AlertDescription } from '@louez/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@louez/ui'
import { cn } from '@louez/utils'

import type { SmsLog, SmsMonthStats, TopupTransaction } from './actions'
import type { SmsQuotaStatus } from '@/lib/plan-limits'
import { TopupModal } from './topup-modal'
import { TopupHistory } from './topup-history'

const localeMap: Record<string, Locale> = {
  fr,
  en: enUS,
  de,
  es,
  it,
  nl,
  pl,
  pt,
}

interface SmsContentProps {
  quotaStatus: SmsQuotaStatus
  creditsInfo: {
    balance: number
    totalPurchased: number
    totalUsed: number
  }
  smsLogs: SmsLog[]
  monthStats: SmsMonthStats
  selectedYear: number
  selectedMonth: number
  isCurrentMonth: boolean
  availableMonths: { year: number; month: number }[]
  topupHistory: TopupTransaction[]
  topupSuccess?: boolean
  topupCancelled?: boolean
}

const TEMPLATE_TYPE_LABELS: Record<string, string> = {
  instant_access: 'instantAccess',
  reservation_confirmation: 'reservationConfirmation',
  reminder_pickup: 'reminderPickup',
  reminder_return: 'reminderReturn',
  request_received: 'requestReceived',
  request_accepted: 'requestAccepted',
  custom: 'custom',
  thank_you_review: 'thankYouReview',
}

export function SmsContent({
  quotaStatus,
  creditsInfo,
  smsLogs,
  monthStats,
  selectedYear,
  selectedMonth,
  isCurrentMonth,
  availableMonths,
  topupHistory,
  topupSuccess,
  topupCancelled,
}: SmsContentProps) {
  const t = useTranslations('dashboard.sms')
  const locale = useLocale()
  const router = useRouter()
  const [selectedSms, setSelectedSms] = useState<SmsLog | null>(null)
  const [showTopupModal, setShowTopupModal] = useState(false)
  const [showSuccessAlert, setShowSuccessAlert] = useState(topupSuccess)
  const [showCancelledAlert, setShowCancelledAlert] = useState(topupCancelled)

  const dateLocale = localeMap[locale] || fr

  // Clear URL params after showing alerts
  useEffect(() => {
    if (topupSuccess || topupCancelled) {
      const timer = setTimeout(() => {
        router.replace('/dashboard/sms')
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [topupSuccess, topupCancelled, router])

  // Auto-hide alerts after 5 seconds
  useEffect(() => {
    if (showSuccessAlert) {
      const timer = setTimeout(() => setShowSuccessAlert(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [showSuccessAlert])

  useEffect(() => {
    if (showCancelledAlert) {
      const timer = setTimeout(() => setShowCancelledAlert(false), 5000)
      return () => clearTimeout(timer)
    }
  }, [showCancelledAlert])

  // For current month, use live quota; for past months, show historical stats
  const displayCurrent = isCurrentMonth ? quotaStatus.current : monthStats.sent
  const planLimit = quotaStatus.planLimit
  const prepaidBalance = creditsInfo.balance

  // Total available = plan limit + prepaid (for display only when viewing current month)
  const totalAvailable = planLimit !== null ? planLimit + prepaidBalance : null

  // Calculate percentage based on plan limit only (prepaid is bonus)
  const percentUsed = planLimit
    ? Math.min(100, Math.round((displayCurrent / planLimit) * 100))
    : 0

  const isNearLimit = isCurrentMonth && planLimit && percentUsed >= 80 && prepaidBalance === 0
  const isAtLimit = isCurrentMonth && totalAvailable !== null && displayCurrent >= totalAvailable

  // Check if plan limit is exhausted but prepaid credits are available
  const usingPrepaid = isCurrentMonth && planLimit !== null && displayCurrent >= planLimit && prepaidBalance > 0

  // Format month for display
  const formatMonthYear = (year: number, month: number) => {
    const date = new Date(year, month, 1)
    return format(date, 'MMMM yyyy', { locale: dateLocale })
  }

  const handleMonthChange = (year: number, month: number) => {
    const now = new Date()
    if (year === now.getFullYear() && month === now.getMonth()) {
      router.push('/dashboard/sms')
    } else {
      router.push(`/dashboard/sms?year=${year}&month=${month}`)
    }
  }

  return (
    <div className="space-y-6">
      {/* Success Alert */}
      {showSuccessAlert && (
        <Alert className="border-green-500/50 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-600">
            {t('topup.success')}
          </AlertDescription>
        </Alert>
      )}

      {/* Cancelled Alert */}
      {showCancelledAlert && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertDescription>{t('topup.cancelled')}</AlertDescription>
        </Alert>
      )}

      {/* Header with title and month selector */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="min-w-[180px] justify-between">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4" />
                <span className="capitalize">{formatMonthYear(selectedYear, selectedMonth)}</span>
              </div>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[180px]">
            {availableMonths.map(({ year, month }) => {
              const isSelected = year === selectedYear && month === selectedMonth
              return (
                <DropdownMenuItem
                  key={`${year}-${month}`}
                  onClick={() => handleMonthChange(year, month)}
                  className={cn('capitalize', isSelected && 'bg-muted')}
                >
                  {formatMonthYear(year, month)}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* SMS Quota Card */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <MessageSquare className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">
                  {isCurrentMonth ? t('quota.title') : t('quota.titlePastMonth')}
                </CardTitle>
                <CardDescription>
                  {isCurrentMonth
                    ? t('quota.description')
                    : t('quota.descriptionPastMonth', { month: formatMonthYear(selectedYear, selectedMonth) })}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isAtLimit && (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  {t('quota.limitReached')}
                </Badge>
              )}
              {isCurrentMonth && (
                <Button size="sm" onClick={() => setShowTopupModal(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  {t('quota.topup')}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end justify-between">
            <div>
              <p className="text-4xl font-bold">
                {displayCurrent}
                {isCurrentMonth && totalAvailable !== null && (
                  <span className="text-lg font-normal text-muted-foreground">
                    /{totalAvailable}
                  </span>
                )}
                {isCurrentMonth && totalAvailable === null && (
                  <span className="text-lg font-normal text-muted-foreground">/∞</span>
                )}
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                {isCurrentMonth ? t('quota.smsThisMonth') : t('quota.smsSentThisMonth')}
              </p>
            </div>
            {!isCurrentMonth && monthStats.failed > 0 && (
              <div className="text-right">
                <p className="text-sm text-destructive">
                  {t('quota.failed', { count: monthStats.failed })}
                </p>
              </div>
            )}
          </div>

          {/* Credits breakdown */}
          {isCurrentMonth && planLimit !== null && (
            <div className="flex items-center gap-4">
              <div className="flex-1 rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-xs text-muted-foreground">{t('quota.planIncluded')}</p>
                <p className="text-sm font-medium">
                  {Math.min(displayCurrent, planLimit)}/{planLimit} SMS
                </p>
              </div>
              <div className="flex-1 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex items-center gap-1">
                  <p className="text-xs text-muted-foreground">{t('quota.prepaidCredits')}</p>
                  {usingPrepaid && <Sparkles className="h-3 w-3 text-amber-500" />}
                </div>
                <p className="text-sm font-medium">
                  {prepaidBalance} SMS
                  {usingPrepaid && (
                    <span className="text-xs text-amber-600 ml-1">
                      (-{displayCurrent - planLimit} {t('quota.used').toLowerCase()})
                    </span>
                  )}
                </p>
              </div>
            </div>
          )}

          {isCurrentMonth && planLimit !== null && (
            <div className="space-y-2">
              <Progress
                value={percentUsed}
                className={cn(
                  'h-2',
                  isAtLimit && '[&>div]:bg-destructive',
                  isNearLimit && !isAtLimit && '[&>div]:bg-amber-500'
                )}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {percentUsed}% {t('quota.used')}
                </span>
                <span>{t('quota.resetsMonthly')}</span>
              </div>
            </div>
          )}

          {/* At limit CTA - shows topup modal (which handles upgrade for Start plan) */}
          {isAtLimit && (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {quotaStatus.canTopup ? t('quota.topupMessage') : t('quota.upgradeMessage')}
              </p>
              <Button variant="outline" size="sm" onClick={() => setShowTopupModal(true)}>
                {quotaStatus.canTopup ? t('quota.topupNow') : t('quota.upgradePlan')}
                <Plus className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}

          {/* Near limit warning with top-up option */}
          {isNearLimit && !isAtLimit && (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t('quota.nearLimit', { count: planLimit ? planLimit - displayCurrent : 0 })}
              </p>
              <Button variant="ghost" size="sm" onClick={() => setShowTopupModal(true)}>
                {t('quota.topup')}
                <Plus className="ml-1 h-3 w-3" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top-up History */}
      {topupHistory.length > 0 && <TopupHistory transactions={topupHistory} />}

      {/* SMS History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('history.title')}</CardTitle>
          <CardDescription>
            {isCurrentMonth
              ? t('history.description')
              : t('history.descriptionMonth', { month: formatMonthYear(selectedYear, selectedMonth) })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {smsLogs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="p-3 rounded-full bg-muted mb-4">
                <MessageSquare className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-muted-foreground">
                {isCurrentMonth ? t('history.empty') : t('history.emptyMonth')}
              </p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">{t('history.date')}</TableHead>
                    <TableHead>{t('history.recipient')}</TableHead>
                    <TableHead>{t('history.type')}</TableHead>
                    <TableHead className="w-[100px] text-center">{t('history.status')}</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {smsLogs.map((log) => (
                    <TableRow
                      key={log.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedSms(log)}
                    >
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2 text-sm">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          {format(new Date(log.sentAt), 'dd MMM yyyy', { locale: dateLocale })}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {format(new Date(log.sentAt), 'HH:mm', { locale: dateLocale })}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {log.customerName && (
                            <div className="flex items-center gap-2 text-sm">
                              <User className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>{log.customerName}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Phone className="h-3.5 w-3.5" />
                            <span className="font-mono text-xs">{log.to}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="font-normal">
                          {t(`types.${TEMPLATE_TYPE_LABELS[log.templateType] || 'custom'}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        {log.status === 'sent' ? (
                          <div className="flex items-center justify-center gap-1 text-green-600">
                            <CheckCircle2 className="h-4 w-4" />
                            <span className="text-xs">{t('status.sent')}</span>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center gap-1 text-destructive">
                            <XCircle className="h-4 w-4" />
                            <span className="text-xs">{t('status.failed')}</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedSms(log)
                          }}
                        >
                          <Eye className="h-4 w-4" />
                          <span className="sr-only">{t('history.view')}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SMS Detail Modal */}
      <Dialog open={!!selectedSms} onOpenChange={() => setSelectedSms(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              {t('detail.title')}
            </DialogTitle>
            <DialogDescription>
              {selectedSms &&
                format(new Date(selectedSms.sentAt), "EEEE d MMMM yyyy 'à' HH:mm", {
                  locale: dateLocale,
                })}
            </DialogDescription>
          </DialogHeader>
          {selectedSms && (
            <div className="space-y-4">
              {/* Recipient info */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{t('detail.recipient')}</p>
                <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                  {selectedSms.customerName && (
                    <div className="flex items-center gap-2 text-sm">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{selectedSms.customerName}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4" />
                    <span className="font-mono">{selectedSms.to}</span>
                  </div>
                </div>
              </div>

              {/* Status and Type */}
              <div className="flex items-center gap-3">
                <Badge variant="secondary">
                  {t(`types.${TEMPLATE_TYPE_LABELS[selectedSms.templateType] || 'custom'}`)}
                </Badge>
                {selectedSms.status === 'sent' ? (
                  <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    {t('status.sent')}
                  </Badge>
                ) : (
                  <Badge variant="destructive">
                    <XCircle className="mr-1 h-3 w-3" />
                    {t('status.failed')}
                  </Badge>
                )}
              </div>

              {/* Message content */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">{t('detail.message')}</p>
                <div className="rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm whitespace-pre-wrap">{selectedSms.message}</p>
                </div>
              </div>

              {/* Error message if failed */}
              {selectedSms.status === 'failed' && selectedSms.error && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-destructive">{t('detail.error')}</p>
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                    <p className="text-sm text-destructive">{selectedSms.error}</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Top-up Modal */}
      <TopupModal
        open={showTopupModal}
        onOpenChange={setShowTopupModal}
        priceCents={quotaStatus.topupPriceCents ?? 0}
        planSlug={quotaStatus.planSlug}
      />
    </div>
  )
}
