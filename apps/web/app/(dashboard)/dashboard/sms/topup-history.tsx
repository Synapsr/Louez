'use client'

import { useTranslations, useLocale } from 'next-intl'
import { format, type Locale } from 'date-fns'
import { fr, enUS, de, es, it, nl, pl, pt } from 'date-fns/locale'
import { CheckCircle2, Clock, XCircle, RefreshCw, History } from 'lucide-react'
import { formatStoreDate } from '@/lib/utils/store-date'
import { useStoreTimezone } from '@/contexts/store-context'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@louez/ui'

import type { TopupTransaction } from './actions'

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

interface TopupHistoryProps {
  transactions: TopupTransaction[]
}

export function TopupHistory({ transactions }: TopupHistoryProps) {
  const t = useTranslations('dashboard.sms.topupHistory')
  const locale = useLocale()
  const timezone = useStoreTimezone()
  const dateLocale = localeMap[locale] || fr

  const formatPrice = (cents: number) => {
    return (cents / 100).toFixed(2).replace('.', ',') + '€'
  }

  const getStatusBadge = (status: TopupTransaction['status']) => {
    switch (status) {
      case 'completed':
        return (
          <Badge variant="success">
            <CheckCircle2 className="mr-1 h-3 w-3" />
            {t('status.completed')}
          </Badge>
        )
      case 'pending':
        return (
          <Badge variant="secondary">
            <Clock className="mr-1 h-3 w-3" />
            {t('status.pending')}
          </Badge>
        )
      case 'failed':
        return (
          <Badge variant="error">
            <XCircle className="mr-1 h-3 w-3" />
            {t('status.failed')}
          </Badge>
        )
      case 'refunded':
        return (
          <Badge variant="outline">
            <RefreshCw className="mr-1 h-3 w-3" />
            {t('status.refunded')}
          </Badge>
        )
    }
  }

  // Calculate totals for completed transactions
  const completedTransactions = transactions.filter((t) => t.status === 'completed')
  const totalSms = completedTransactions.reduce((sum, t) => sum + t.quantity, 0)
  const totalSpent = completedTransactions.reduce((sum, t) => sum + t.totalAmountCents, 0)

  if (transactions.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-muted">
            <History className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <CardTitle className="text-lg">{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('date')}</TableHead>
                <TableHead className="text-right">{t('quantity')}</TableHead>
                <TableHead className="text-right">{t('unitPrice')}</TableHead>
                <TableHead className="text-right">{t('total')}</TableHead>
                <TableHead className="text-center">{t('statusColumn')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transactions.map((transaction) => (
                <TableRow key={transaction.id}>
                  <TableCell>
                    <div className="text-sm">
                      {format(new Date(transaction.createdAt), 'dd MMM yyyy', {
                        locale: dateLocale,
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatStoreDate(new Date(transaction.createdAt), timezone, 'TIME_ONLY')}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {transaction.quantity} SMS
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {formatPrice(transaction.unitPriceCents)}
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatPrice(transaction.totalAmountCents)}
                  </TableCell>
                  <TableCell className="text-center">
                    {getStatusBadge(transaction.status)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Summary */}
        {completedTransactions.length > 0 && (
          <div className="mt-4 flex items-center justify-end gap-6 text-sm">
            <div className="text-muted-foreground">
              {t('totalPurchased')}: <span className="font-medium text-foreground">{totalSms} SMS</span>
            </div>
            <div className="text-muted-foreground">
              {t('totalSpent')}: <span className="font-medium text-foreground">{formatPrice(totalSpent)}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
