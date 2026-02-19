'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  AlertCircle,
  Unlink,
} from 'lucide-react'

import { Button } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@louez/ui'
import { toastManager } from '@louez/ui'

import {
  startStripeOnboarding,
  syncStripeStatus,
  getStripeDashboardUrl,
  disconnectStripe,
} from './actions'

interface StripeConnectCardProps {
  stripeAccountId: string | null
  stripeChargesEnabled: boolean
  stripeOnboardingComplete: boolean
}

export function StripeConnectCard({
  stripeAccountId,
  stripeChargesEnabled,
  stripeOnboardingComplete,
}: StripeConnectCardProps) {
  const t = useTranslations('dashboard.settings.payments')
  const tErrors = useTranslations('errors')
  const router = useRouter()

  const [isConnecting, setIsConnecting] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [isOpeningDashboard, setIsOpeningDashboard] = useState(false)

  const isConnected = !!stripeAccountId
  const isActive = stripeChargesEnabled && stripeOnboardingComplete

  const handleConnect = async () => {
    setIsConnecting(true)
    try {
      const result = await startStripeOnboarding()
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else if (result.url) {
        window.location.href = result.url
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsConnecting(false)
    }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      const result = await syncStripeStatus()
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else {
        toastManager.add({ title: t('synced'), type: 'success' })
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsSyncing(false)
    }
  }

  const handleOpenDashboard = async () => {
    setIsOpeningDashboard(true)
    try {
      const result = await getStripeDashboardUrl()
      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
      } else if (result.url) {
        window.open(result.url, '_blank')
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsOpeningDashboard(false)
    }
  }

  const handleDisconnect = async () => {
    const result = await disconnectStripe()
    if (result.error) {
      toastManager.add({ title: tErrors(result.error.replace('errors.', '')), type: 'error' })
    } else {
      toastManager.add({ title: t('disconnected'), type: 'success' })
      router.refresh()
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle>{t('stripeConnect')}</CardTitle>
            <CardDescription>{t('stripeConnectDescription')}</CardDescription>
          </div>
          {isConnected && (
            <Badge variant={isActive ? 'default' : 'secondary'}>
              {isActive ? (
                <>
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  {t('status.active')}
                </>
              ) : (
                <>
                  <AlertCircle className="mr-1 h-3 w-3" />
                  {t('status.incomplete')}
                </>
              )}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {!isConnected ? (
          // Not connected state
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{t('notConnectedDescription')}</p>
            <Button onClick={handleConnect} disabled={isConnecting}>
              {isConnecting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('connectStripe')}
            </Button>
          </div>
        ) : isActive ? (
          // Connected and active
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/50 p-4">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span>{t('activeDescription')}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={handleOpenDashboard}
                disabled={isOpeningDashboard}
              >
                {isOpeningDashboard ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="mr-2 h-4 w-4" />
                )}
                {t('openDashboard')}
              </Button>

              <Button variant="outline" onClick={handleSync} disabled={isSyncing}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
                />
                {t('sync')}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="ghost" className="text-destructive" />}>
                  <Unlink className="mr-2 h-4 w-4" />
                  {t('disconnect')}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('disconnectTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('disconnectDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose render={<Button variant="outline" />}>{t('cancel')}</AlertDialogClose>
                    <AlertDialogClose
                      render={<Button variant="destructive" />}
                      onClick={handleDisconnect}
                    >
                      {t('disconnect')}
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ) : (
          // Connected but incomplete
          <div className="space-y-4">
            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900 dark:bg-yellow-900/20">
              <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-200">
                <AlertCircle className="h-4 w-4" />
                <span>{t('incompleteDescription')}</span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleConnect} disabled={isConnecting}>
                {isConnecting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t('completeSetup')}
              </Button>

              <Button variant="outline" onClick={handleSync} disabled={isSyncing}>
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`}
                />
                {t('sync')}
              </Button>

              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="ghost" className="text-destructive" />}>
                  <Unlink className="mr-2 h-4 w-4" />
                  {t('disconnect')}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('disconnectTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('disconnectDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogClose render={<Button variant="outline" />}>{t('cancel')}</AlertDialogClose>
                    <AlertDialogClose
                      render={<Button variant="destructive" />}
                      onClick={handleDisconnect}
                    >
                      {t('disconnect')}
                    </AlertDialogClose>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
