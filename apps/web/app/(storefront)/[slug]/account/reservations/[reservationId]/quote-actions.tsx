'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@louez/ui'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@louez/ui'
import { acceptQuote, declineQuote } from './actions'

interface QuoteActionsProps {
  storeSlug: string
  reservationId: string
}

export function QuoteActions({ storeSlug, reservationId }: QuoteActionsProps) {
  const t = useTranslations('storefront.account')
  const [isAccepting, setIsAccepting] = useState(false)
  const [isDeclining, setIsDeclining] = useState(false)
  const [declineDialogOpen, setDeclineDialogOpen] = useState(false)
  const router = useRouter()

  const handleAccept = async () => {
    setIsAccepting(true)
    try {
      const result = await acceptQuote(storeSlug, reservationId)
      if (result.error) {
        console.error('Failed to accept quote:', result.error)
      } else {
        router.refresh()
      }
    } catch (error) {
      console.error('Failed to accept quote:', error)
    } finally {
      setIsAccepting(false)
    }
  }

  const handleDecline = async () => {
    setIsDeclining(true)
    try {
      const result = await declineQuote(storeSlug, reservationId)
      if (result.error) {
        console.error('Failed to decline quote:', result.error)
      } else {
        router.refresh()
      }
    } catch (error) {
      console.error('Failed to decline quote:', error)
    } finally {
      setIsDeclining(false)
      setDeclineDialogOpen(false)
    }
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
        <Button
          onClick={handleAccept}
          disabled={isAccepting || isDeclining}
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          {isAccepting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="mr-2 h-4 w-4" />
          )}
          {t('quote.accept')}
        </Button>
        <Button
          variant="outline"
          onClick={() => setDeclineDialogOpen(true)}
          disabled={isAccepting || isDeclining}
          className="border-red-200 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950/50"
        >
          <XCircle className="mr-2 h-4 w-4" />
          {t('quote.decline')}
        </Button>
      </div>

      <AlertDialog open={declineDialogOpen} onOpenChange={setDeclineDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('quote.declineTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('quote.declineDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('quote.cancel')}
            </AlertDialogClose>
            <Button
              variant="destructive"
              onClick={handleDecline}
              disabled={isDeclining}
            >
              {isDeclining && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('quote.confirmDecline')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
