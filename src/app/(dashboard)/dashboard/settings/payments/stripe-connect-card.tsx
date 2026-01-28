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

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

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
        toast.error(tErrors(result.error.replace('errors.', '')))
      } else if (result.url) {
        window.location.href = result.url
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsConnecting(false)
    }
  }

  const handleSync = async () => {
    setIsSyncing(true)
    try {
      const result = await syncStripeStatus()
      if (result.error) {
        toast.error(tErrors(result.error.replace('errors.', '')))
      } else {
        toast.success(t('synced'))
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsSyncing(false)
    }
  }

  const handleOpenDashboard = async () => {
    setIsOpeningDashboard(true)
    try {
      const result = await getStripeDashboardUrl()
      if (result.error) {
        toast.error(tErrors(result.error.replace('errors.', '')))
      } else if (result.url) {
        window.open(result.url, '_blank')
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsOpeningDashboard(false)
    }
  }

  const handleDisconnect = async () => {
    const result = await disconnectStripe()
    if (result.error) {
      toast.error(tErrors(result.error.replace('errors.', '')))
    } else {
      toast.success(t('disconnected'))
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
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-destructive">
                    <Unlink className="mr-2 h-4 w-4" />
                    {t('disconnect')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('disconnectTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('disconnectDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDisconnect}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {t('disconnect')}
                    </AlertDialogAction>
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
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" className="text-destructive">
                    <Unlink className="mr-2 h-4 w-4" />
                    {t('disconnect')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t('disconnectTitle')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('disconnectDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={handleDisconnect}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                      {t('disconnect')}
                    </AlertDialogAction>
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
