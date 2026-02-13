'use client'

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
import { Avatar, AvatarFallback, AvatarImage } from '@louez/ui'
import { Users, Sparkles, Crown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { formatDate } from '@louez/utils'
import type { ReferralData } from './actions'

interface ReferralsListProps {
  referrals: ReferralData[]
}

function PlanBadge({ plan }: { plan: string }) {
  const config: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
    start: {
      label: 'Start',
      icon: null,
      className: 'bg-muted text-muted-foreground border-transparent',
    },
    pro: {
      label: 'Pro',
      icon: <Sparkles className="h-3 w-3" />,
      className: 'bg-primary/10 text-primary border-primary/20',
    },
    ultra: {
      label: 'Ultra',
      icon: <Crown className="h-3 w-3" />,
      className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
  }

  const c = config[plan] || config.start

  return (
    <Badge variant="outline" className={c.className}>
      {c.icon}
      {c.label}
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('dashboard.referrals.list.status')

  const variants: Record<string, 'default' | 'secondary' | 'error' | 'outline'> = {
    active: 'default',
    cancelled: 'secondary',
    past_due: 'error',
    trialing: 'outline',
  }

  return <Badge variant={variants[status] || 'secondary'}>{t(status)}</Badge>
}

export function ReferralsList({ referrals }: ReferralsListProps) {
  const t = useTranslations('dashboard.referrals.list')

  if (referrals.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted mb-4">
            <Users className="h-7 w-7 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">{t('empty')}</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {t('emptyDescription')}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>
          {t('count', { count: referrals.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.store')}</TableHead>
                <TableHead>{t('columns.joined')}</TableHead>
                <TableHead>{t('columns.plan')}</TableHead>
                <TableHead>{t('columns.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {referrals.map((referral) => (
                <TableRow key={referral.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={referral.logoUrl || undefined} />
                        <AvatarFallback className="text-xs">
                          {referral.name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{referral.name}</div>
                        <div className="truncate text-sm text-muted-foreground">
                          {referral.slug}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(referral.joinedAt)}
                  </TableCell>
                  <TableCell>
                    <PlanBadge plan={referral.planSlug} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={referral.subscriptionStatus} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
