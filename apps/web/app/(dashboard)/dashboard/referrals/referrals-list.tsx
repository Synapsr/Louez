'use client'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@louez/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@louez/ui'
import { Users } from 'lucide-react'
import { SparklesSolidIcon, StarSolidIcon, ZapSolidIcon } from '@louez/ui/icons'
import { useTranslations } from 'next-intl'
import { formatDate } from '@louez/utils'
import { useFormatLocale } from '@/hooks/use-format-locale'
import type { ReferralData } from './actions'

interface ReferralsListProps {
  referrals: ReferralData[]
}

function PlanBadge({ plan }: { plan: string }) {
  const config: Record<
    string,
    {
      label: string;
      icon: React.ReactNode;
      variant: "submitted" | "review" | "success";
    }
  > = {
    pro: {
      label: 'Pro',
      icon: <SparklesSolidIcon className="h-3 w-3" />,
      variant: 'submitted' as const,
    },
    ultra: {
      label: 'Ultra',
      icon: <StarSolidIcon className="h-3 w-3" />,
      variant: 'review' as const,
    },
    pay_as_you_go: {
      label: 'Pay as you go',
      icon: <ZapSolidIcon className="h-3 w-3" />,
      variant: 'success' as const,
    },
  }

  const c = config[plan] || config.pay_as_you_go

  return (
    <Badge variant={c.variant}>
      {c.icon}
      {c.label}
    </Badge>
  )
}

function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('dashboard.referrals.list.status')

  const variants: Record<string, 'success' | 'expired' | 'failed' | 'progress'> = {
    active: 'success',
    cancelled: 'expired',
    past_due: 'failed',
    trialing: 'progress',
  }

  return <Badge variant={variants[status] || 'expired'}>{t(status)}</Badge>
}

function RewardBadge({ rewarded }: { rewarded: boolean }) {
  const t = useTranslations('dashboard.referrals.list.reward')

  return rewarded ? (
    <Badge variant="success">{t('rewarded')}</Badge>
  ) : (
    <Badge variant="pending">{t('pending')}</Badge>
  )
}

export function ReferralsList({ referrals }: ReferralsListProps) {
  const { intl: formatLocale } = useFormatLocale()
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
                <TableHead>{t('columns.reward')}</TableHead>
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
                    {formatDate(referral.joinedAt, undefined, formatLocale)}
                  </TableCell>
                  <TableCell>
                    <PlanBadge plan={referral.planSlug} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={referral.subscriptionStatus} />
                  </TableCell>
                  <TableCell>
                    <RewardBadge rewarded={referral.rewarded} />
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
